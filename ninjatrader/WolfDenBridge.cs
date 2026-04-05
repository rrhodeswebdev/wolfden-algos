#region Using declarations
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.Strategies;
#endregion

namespace NinjaTrader.NinjaScript.Strategies
{
    public class WolfDenBridge : Strategy
    {
        #region Private Fields

        private WsClient                                    _ws;
        private OrderTracker                                _orderTracker;
        private CancellationTokenSource                     _cts;
        private Timer                                       _heartbeatTimer;

        private string                                      _sourceId;
        private string                                      _chartId;
        private string                                      _symbol;
        private string                                      _timeframeStr;

        private double                                      _lastBid;
        private double                                      _lastAsk;

        private double                                      _cachedBuyingPower;
        private double                                      _cachedCash;
        private double                                      _cachedRealizedPnl;
        private DateTime                                    _lastAccountSend = DateTime.MinValue;
        private DateTime                                    _lastPositionSend = DateTime.MinValue;

        private bool                                        _isRealtime;

        // Pre-built history JSON (built on NinjaScript thread, sent from background task)
        private volatile string                             _historyJson;

        // Pending bracket orders: entry Wolf Den ID -> BracketCommand
        private ConcurrentDictionary<string, BracketCmd>    _pendingBrackets;

        #endregion

        #region Strategy Lifecycle

        protected override void OnStateChange()
        {
            switch (State)
            {
                case State.SetDefaults:
                    Description     = "Bridges NinjaTrader to the Wolf Den desktop application via WebSocket.";
                    Name            = "WolfDenBridge";
                    Calculate       = Calculate.OnEachTick;
                    IsUnmanaged     = true;
                    // Do not interfere with manual trading
                    IsExitOnSessionCloseStrategy = false;

                    WolfDenEndpoint     = "";
                    WolfDenPort         = 9000;
                    HeartbeatSeconds    = 5;
                    ReconnectSeconds    = 3;
                    AutoReconnect       = true;
                    SendTicks           = true;
                    SendBars            = true;
                    break;

                case State.DataLoaded:
                    _symbol         = Instrument.FullName;
                    _timeframeStr   = FormatTimeframe();
                    _sourceId       = _symbol + ":" + _timeframeStr;
                    _chartId        = Guid.NewGuid().ToString("N").Substring(0, 12);
                    _orderTracker   = new OrderTracker();
                    _pendingBrackets = new ConcurrentDictionary<string, BracketCmd>();
                    _cts            = new CancellationTokenSource();
                    _ws             = new WsClient(msg => Print("WolfDenBridge: " + msg));
                    break;

                case State.Realtime:
                    _isRealtime = true;
                    BuildHistoryJson();
                    ConnectAsync();
                    break;

                case State.Terminated:
                    _isRealtime = false;
                    Cleanup();
                    break;
            }
        }

        private void ConnectAsync()
        {
            var uri = GetWsUri();
            var token = _cts.Token;

            Task.Run(async () =>
            {
                try
                {
                    await _ws.ConnectAsync(uri, token);
                    Print("WolfDenBridge: Connected to " + uri);

                    SendRegister();
                    SendHistory();

                    _heartbeatTimer = new Timer(_ => SendHeartbeat(), null,
                        TimeSpan.FromSeconds(HeartbeatSeconds),
                        TimeSpan.FromSeconds(HeartbeatSeconds));

                    await ReceiveLoopAsync(token);
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    Print("WolfDenBridge: Connection error — " + ex.Message);
                }
                finally
                {
                    StopHeartbeat();
                }

                if (AutoReconnect && !token.IsCancellationRequested)
                    await ReconnectLoopAsync(token);
            }, token);
        }

        private async Task ReconnectLoopAsync(CancellationToken token)
        {
            int delay = ReconnectSeconds;

            while (!token.IsCancellationRequested)
            {
                Print("WolfDenBridge: Reconnecting in " + delay + "s...");
                try { await Task.Delay(delay * 1000, token); }
                catch (OperationCanceledException) { return; }

                try
                {
                    var uri = GetWsUri();
                    await _ws.ConnectAsync(uri, token);
                    Print("WolfDenBridge: Reconnected to " + uri);

                    SendRegister();
                    SendHistory();

                    _heartbeatTimer = new Timer(_ => SendHeartbeat(), null,
                        TimeSpan.FromSeconds(HeartbeatSeconds),
                        TimeSpan.FromSeconds(HeartbeatSeconds));

                    delay = ReconnectSeconds;
                    await ReceiveLoopAsync(token);
                }
                catch (OperationCanceledException) { return; }
                catch (Exception ex)
                {
                    Print("WolfDenBridge: Reconnect failed — " + ex.Message);
                }
                finally
                {
                    StopHeartbeat();
                }

                delay = Math.Min(delay * 2, 30);
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                string json = await _ws.ReceiveAsync(token);
                if (json == null) break;

                try
                {
                    string type = Json.ReadString(json, "type");

                    switch (type)
                    {
                        case "order":
                            var orderCmd = ParseOrderCmd(json);
                            TriggerCustomEvent(state => ExecuteOrder((OrderCmd)state), orderCmd);
                            break;

                        case "cancel":
                            var cancelCmd = new CancelCmd { order_id = Json.ReadString(json, "order_id") };
                            TriggerCustomEvent(state => ExecuteCancel((CancelCmd)state), cancelCmd);
                            break;

                        case "modify":
                            var modifyCmd = ParseModifyCmd(json);
                            TriggerCustomEvent(state => ExecuteModify((ModifyCmd)state), modifyCmd);
                            break;

                        case "bracket":
                            var bracketCmd = ParseBracketCmd(json);
                            TriggerCustomEvent(state => ExecuteBracket((BracketCmd)state), bracketCmd);
                            break;

                        case "heartbeat":
                            break;

                        default:
                            Print("WolfDenBridge: Unknown command type: " + type);
                            break;
                    }
                }
                catch (Exception ex)
                {
                    Print("WolfDenBridge: Failed to parse command — " + ex.Message);
                }
            }
        }

        private void Cleanup()
        {
            try { _cts?.Cancel(); } catch { }
            StopHeartbeat();
            try { _ws?.Dispose(); } catch { }
            try { _cts?.Dispose(); } catch { }
        }

        private void StopHeartbeat()
        {
            try { _heartbeatTimer?.Dispose(); } catch { }
            _heartbeatTimer = null;
        }

        #endregion

        #region NinjaTrader Event Handlers

        protected override void OnBarUpdate()
        {
            if (!_isRealtime || !SendBars) return;
            if (_ws == null || !_ws.IsConnected) return;

            if (!IsFirstTickOfBar || CurrentBar < 1) return;

            _ws.Send(Json.Build(
                "type",       "bar",
                "source_id",  _sourceId,
                "symbol",     _symbol,
                "o",          Opens[0][1],
                "h",          Highs[0][1],
                "l",          Lows[0][1],
                "c",          Closes[0][1],
                "v",          (long)Volumes[0][1],
                "timestamp",  ToUnixMs(Times[0][1])
            ));
        }

        protected override void OnMarketData(MarketDataEventArgs e)
        {
            if (!_isRealtime) return;

            switch (e.MarketDataType)
            {
                case MarketDataType.Bid:
                    _lastBid = e.Price;
                    return;
                case MarketDataType.Ask:
                    _lastAsk = e.Price;
                    return;
                case MarketDataType.Last:
                    break;
                default:
                    return;
            }

            if (_ws == null || !_ws.IsConnected) return;

            if (SendTicks)
            {
                _ws.Send(Json.Build(
                    "type",       "tick",
                    "source_id",  _sourceId,
                    "symbol",     _symbol,
                    "price",      e.Price,
                    "size",       (long)e.Volume,
                    "bid",        _lastBid,
                    "ask",        _lastAsk,
                    "timestamp",  ToUnixMs(e.Time)
                ));
            }

            // Send live position snapshot every 500ms so frontend P&L stays current
            if (Position.MarketPosition != MarketPosition.Flat
                && (e.Time - _lastPositionSend).TotalMilliseconds >= 500)
            {
                _lastPositionSend = e.Time;

                string direction = Position.MarketPosition == MarketPosition.Long ? "Long" : "Short";
                double unrealizedPnl = 0;
                try { unrealizedPnl = Position.GetUnrealizedProfitLoss(PerformanceUnit.Currency); }
                catch { }

                _ws.Send(Json.Build(
                    "type",           "position",
                    "source_id",      _sourceId,
                    "symbol",         _symbol,
                    "direction",      direction,
                    "qty",            (long)Position.Quantity,
                    "avg_price",      Position.AveragePrice,
                    "unrealized_pnl", unrealizedPnl
                ));
            }
        }

        protected override void OnOrderUpdate(Order order, double limitPrice, double stopPrice,
            int quantity, int filled, double averageFillPrice, OrderState orderState,
            DateTime time, ErrorCode error, string comment)
        {
            if (!_isRealtime || _ws == null || !_ws.IsConnected) return;

            string wolfDenId = _orderTracker.GetWolfDenId(order);
            if (wolfDenId == null) return;

            string instanceId = _orderTracker.GetInstanceId(wolfDenId);
            string stateStr = MapOrderState(orderState);
            if (stateStr == null) return;

            var sb = new StringBuilder(256);
            sb.Append("{");
            Json.Append(sb, "type",           "order_update");
            Json.Append(sb, "source_id",      _sourceId);
            Json.Append(sb, "instance_id",    instanceId ?? "");
            Json.Append(sb, "order_id",       wolfDenId);
            Json.Append(sb, "state",          stateStr);
            Json.Append(sb, "filled_qty",     filled);
            Json.Append(sb, "avg_fill_price", averageFillPrice);
            Json.Append(sb, "remaining",      quantity - filled);
            Json.Append(sb, "timestamp",      ToUnixMs(time));
            if (orderState == OrderState.Rejected)
                Json.Append(sb, "error", error.ToString() + (string.IsNullOrEmpty(comment) ? "" : ": " + comment));
            // Remove trailing comma, close object
            if (sb[sb.Length - 1] == ',') sb.Length--;
            sb.Append("}");
            _ws.Send(sb.ToString());

            if (orderState == OrderState.Filled || orderState == OrderState.Cancelled || orderState == OrderState.Rejected)
                _orderTracker.Remove(wolfDenId);
        }

        protected override void OnExecutionUpdate(Execution execution, string executionId,
            double price, int quantity, MarketPosition marketPosition, string orderId, DateTime time)
        {
            if (!_isRealtime || _ws == null || !_ws.IsConnected) return;

            string wolfDenId = _orderTracker.GetWolfDenIdBySignalName(orderId);
            if (wolfDenId != null)
            {
                BracketCmd bracket;
                if (_pendingBrackets.TryRemove(wolfDenId, out bracket))
                    SubmitBracketExits(bracket, execution.Order.OrderAction);
            }

            if (wolfDenId == null) return;
            string instanceId = _orderTracker.GetInstanceId(wolfDenId);

            _ws.Send(Json.Build(
                "type",           "order_update",
                "source_id",      _sourceId,
                "instance_id",    instanceId ?? "",
                "order_id",       wolfDenId,
                "state",          quantity == execution.Order.Quantity ? "filled" : "partial",
                "filled_qty",     execution.Order.Filled,
                "avg_fill_price", execution.Order.AverageFillPrice,
                "fill_price",     price,
                "remaining",      execution.Order.Quantity - execution.Order.Filled,
                "timestamp",      ToUnixMs(time)
            ));
        }

        protected override void OnPositionUpdate(Position position, double averagePrice,
            int quantity, MarketPosition marketPosition)
        {
            if (!_isRealtime || _ws == null || !_ws.IsConnected) return;

            string direction;
            switch (marketPosition)
            {
                case MarketPosition.Long:   direction = "Long";  break;
                case MarketPosition.Short:  direction = "Short"; break;
                default:                    direction = "Flat";  break;
            }

            double unrealizedPnl = 0;
            if (position != null && position.Instrument != null)
            {
                try { unrealizedPnl = position.GetUnrealizedProfitLoss(PerformanceUnit.Currency); }
                catch { }
            }

            _ws.Send(Json.Build(
                "type",           "position",
                "source_id",      _sourceId,
                "symbol",         _symbol,
                "direction",      direction,
                "qty",            quantity,
                "avg_price",      averagePrice,
                "unrealized_pnl", unrealizedPnl
            ));
        }

        protected override void OnAccountItemUpdate(Account account, AccountItem accountItem, double value)
        {
            if (!_isRealtime || _ws == null || !_ws.IsConnected) return;

            switch (accountItem)
            {
                case AccountItem.BuyingPower:           _cachedBuyingPower  = value; break;
                case AccountItem.CashValue:             _cachedCash         = value; break;
                case AccountItem.RealizedProfitLoss:    _cachedRealizedPnl  = value; break;
                default: return;
            }

            if ((DateTime.Now - _lastAccountSend).TotalSeconds < 1) return;
            _lastAccountSend = DateTime.Now;

            _ws.Send(Json.Build(
                "type",         "account",
                "buying_power", _cachedBuyingPower,
                "cash",         _cachedCash,
                "realized_pnl", _cachedRealizedPnl
            ));
        }

        #endregion

        #region Order Execution

        private void ExecuteOrder(OrderCmd cmd)
        {
            try
            {
                OrderAction action = cmd.action == "BUY" ? OrderAction.Buy : OrderAction.Sell;
                Order ntOrder;

                switch (cmd.order_type)
                {
                    case "MARKET":
                        ntOrder = SubmitOrderUnmanaged(0, action, OrderType.Market,
                            cmd.qty, 0, 0, "", cmd.id);
                        break;
                    case "LIMIT":
                        ntOrder = SubmitOrderUnmanaged(0, action, OrderType.Limit,
                            cmd.qty, cmd.limit_price, 0, "", cmd.id);
                        break;
                    case "STOP":
                        ntOrder = SubmitOrderUnmanaged(0, action, OrderType.StopMarket,
                            cmd.qty, 0, cmd.stop_price, "", cmd.id);
                        break;
                    case "STOPLIMIT":
                        ntOrder = SubmitOrderUnmanaged(0, action, OrderType.StopLimit,
                            cmd.qty, cmd.limit_price, cmd.stop_price, "", cmd.id);
                        break;
                    case "MIT":
                        ntOrder = SubmitOrderUnmanaged(0, action, OrderType.MIT,
                            cmd.qty, cmd.limit_price, 0, "", cmd.id);
                        break;
                    default:
                        Print("WolfDenBridge: Unknown order type: " + cmd.order_type);
                        SendOrderReject(cmd.id, cmd.instance_id, "Unknown order type: " + cmd.order_type);
                        return;
                }

                _orderTracker.Track(cmd.id, cmd.instance_id, ntOrder);
            }
            catch (Exception ex)
            {
                Print("WolfDenBridge: Order execution error — " + ex.Message);
                SendOrderReject(cmd.id, cmd.instance_id, ex.Message);
            }
        }

        private void ExecuteCancel(CancelCmd cmd)
        {
            try
            {
                Order ntOrder = _orderTracker.GetNtOrder(cmd.order_id);
                if (ntOrder != null)
                    CancelOrder(ntOrder);
                else
                    Print("WolfDenBridge: Cancel — order not found: " + cmd.order_id);
            }
            catch (Exception ex)
            {
                Print("WolfDenBridge: Cancel error — " + ex.Message);
            }
        }

        private void ExecuteModify(ModifyCmd cmd)
        {
            try
            {
                Order ntOrder = _orderTracker.GetNtOrder(cmd.order_id);
                if (ntOrder != null)
                    ChangeOrder(ntOrder, cmd.qty, cmd.limit_price, cmd.stop_price);
                else
                    Print("WolfDenBridge: Modify — order not found: " + cmd.order_id);
            }
            catch (Exception ex)
            {
                Print("WolfDenBridge: Modify error — " + ex.Message);
            }
        }

        private void ExecuteBracket(BracketCmd cmd)
        {
            try
            {
                var entryLeg = cmd.entry;
                OrderAction entryAction = (entryLeg.action ?? "BUY") == "BUY" ? OrderAction.Buy : OrderAction.Sell;
                OrderType entryType = MapOrderType(entryLeg.order_type);
                int entryQty = entryLeg.qty ?? cmd.stop_loss.qty ?? 1;

                Order entryOrder = SubmitOrderUnmanaged(0, entryAction, entryType,
                    entryQty,
                    entryLeg.limit_price ?? 0,
                    entryLeg.stop_price ?? 0,
                    "", cmd.id);

                _orderTracker.Track(cmd.id, cmd.instance_id, entryOrder);
                _pendingBrackets[cmd.id] = cmd;
            }
            catch (Exception ex)
            {
                Print("WolfDenBridge: Bracket error — " + ex.Message);
                SendOrderReject(cmd.id, cmd.instance_id, ex.Message);
            }
        }

        private void SubmitBracketExits(BracketCmd cmd, OrderAction entryAction)
        {
            try
            {
                OrderAction exitAction = entryAction == OrderAction.Buy ? OrderAction.Sell : OrderAction.Buy;
                string ocoId = "WD_" + Guid.NewGuid().ToString("N").Substring(0, 8);

                var sl = cmd.stop_loss;
                int slQty = sl.qty ?? cmd.entry.qty ?? 1;
                string slId = cmd.id + "_sl";
                Order slOrder = SubmitOrderUnmanaged(0, exitAction, MapOrderType(sl.order_type),
                    slQty, sl.limit_price ?? 0, sl.stop_price ?? 0, ocoId, slId);
                _orderTracker.Track(slId, cmd.instance_id, slOrder);

                var tp = cmd.take_profit;
                int tpQty = tp.qty ?? cmd.entry.qty ?? 1;
                string tpId = cmd.id + "_tp";
                Order tpOrder = SubmitOrderUnmanaged(0, exitAction, MapOrderType(tp.order_type),
                    tpQty, tp.limit_price ?? 0, tp.stop_price ?? 0, ocoId, tpId);
                _orderTracker.Track(tpId, cmd.instance_id, tpOrder);
            }
            catch (Exception ex)
            {
                Print("WolfDenBridge: Bracket exit error — " + ex.Message);
            }
        }

        private void SendOrderReject(string orderId, string instanceId, string error)
        {
            if (_ws == null || !_ws.IsConnected) return;

            _ws.Send(Json.Build(
                "type",        "order_update",
                "source_id",   _sourceId,
                "instance_id", instanceId ?? "",
                "order_id",    orderId,
                "state",       "rejected",
                "error",       error,
                "timestamp",   ToUnixMs(DateTime.UtcNow)
            ));
        }

        #endregion

        #region Outbound Messages

        private void SendRegister()
        {
            if (_ws == null || !_ws.IsConnected) return;

            _ws.Send(Json.Build(
                "type",       "register",
                "instrument", _symbol,
                "timeframe",  _timeframeStr,
                "chart_id",   _chartId,
                "account",    Account.Name
            ));
        }

        /// Builds the history JSON on the NinjaScript thread where data series access is safe.
        /// Must be called from State.Realtime (or another NinjaScript event) before ConnectAsync.
        private void BuildHistoryJson()
        {
            int count = CurrentBar;
            if (count < 1)
            {
                _historyJson = null;
                return;
            }

            var inv = System.Globalization.CultureInfo.InvariantCulture;
            var sb = new StringBuilder(count * 80 + 64);
            sb.Append("{\"type\":\"history\",\"source_id\":\"").Append(EscapeJsonValue(_sourceId));
            sb.Append("\",\"symbol\":\"").Append(EscapeJsonValue(_symbol));
            sb.Append("\",\"bars\":[");

            bool first = true;
            for (int i = count - 1; i >= 1; i--)
            {
                int barsAgo = i;
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"o\":").Append(Opens[0][barsAgo].ToString("R", inv));
                sb.Append(",\"h\":").Append(Highs[0][barsAgo].ToString("R", inv));
                sb.Append(",\"l\":").Append(Lows[0][barsAgo].ToString("R", inv));
                sb.Append(",\"c\":").Append(Closes[0][barsAgo].ToString("R", inv));
                sb.Append(",\"v\":").Append(((long)Volumes[0][barsAgo]).ToString(inv));
                sb.Append(",\"t\":").Append(ToUnixMs(Times[0][barsAgo]).ToString(inv));
                sb.Append('}');
            }

            sb.Append("]}");
            _historyJson = sb.ToString();
            Print("WolfDenBridge: Built history JSON with " + (count - 1) + " bars");
        }

        /// Sends the pre-built history JSON. Safe to call from any thread.
        private void SendHistory()
        {
            if (_ws == null || !_ws.IsConnected) return;
            string json = _historyJson;
            if (json == null) return;
            _ws.Send(json);
            Print("WolfDenBridge: Sent history");
        }

        private static string EscapeJsonValue(string s)
        {
            if (s.IndexOfAny(new[] { '"', '\\' }) < 0) return s;
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private void SendHeartbeat()
        {
            if (_ws == null || !_ws.IsConnected) return;
            _ws.Send("{\"type\":\"heartbeat\"}");
        }

        #endregion

        #region Helpers

        private string GetWsUri()
        {
            if (!string.IsNullOrEmpty(WolfDenEndpoint))
            {
                string ep = WolfDenEndpoint.Trim();
                // If user provided an http(s) URL, convert to ws(s)
                if (ep.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    return "wss://" + ep.Substring(8);
                if (ep.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                    return "ws://" + ep.Substring(7);
                // Already a ws(s) URL
                if (ep.StartsWith("ws://", StringComparison.OrdinalIgnoreCase) ||
                    ep.StartsWith("wss://", StringComparison.OrdinalIgnoreCase))
                    return ep;
                // Bare hostname/domain — assume wss for ngrok-style endpoints
                return "wss://" + ep;
            }
            return "ws://127.0.0.1:" + WolfDenPort;
        }

        private string FormatTimeframe()
        {
            switch (BarsPeriod.BarsPeriodType)
            {
                case BarsPeriodType.Minute:  return BarsPeriod.Value + "min";
                case BarsPeriodType.Day:     return BarsPeriod.Value + "day";
                case BarsPeriodType.Week:    return BarsPeriod.Value + "week";
                case BarsPeriodType.Month:   return BarsPeriod.Value + "month";
                case BarsPeriodType.Second:  return BarsPeriod.Value + "sec";
                case BarsPeriodType.Tick:    return BarsPeriod.Value + "tick";
                case BarsPeriodType.Volume:  return BarsPeriod.Value + "vol";
                case BarsPeriodType.Range:   return BarsPeriod.Value + "range";
                default:                     return BarsPeriod.Value + BarsPeriod.BarsPeriodType.ToString().ToLower();
            }
        }

        private static long ToUnixMs(DateTime dt)
        {
            return (long)(dt.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private static string MapOrderState(OrderState state)
        {
            switch (state)
            {
                case OrderState.Submitted:
                case OrderState.Accepted:        return "submitted";
                case OrderState.Working:         return "working";
                case OrderState.PartFilled:      return "partial";
                case OrderState.Filled:          return "filled";
                case OrderState.Cancelled:
                case OrderState.CancelPending:
                case OrderState.CancelSubmitted: return "cancelled";
                case OrderState.Rejected:        return "rejected";
                default:                         return null;
            }
        }

        private static OrderType MapOrderType(string type)
        {
            switch (type)
            {
                case "MARKET":    return OrderType.Market;
                case "LIMIT":     return OrderType.Limit;
                case "STOP":      return OrderType.StopMarket;
                case "STOPLIMIT": return OrderType.StopLimit;
                case "MIT":       return OrderType.MIT;
                default:          return OrderType.Market;
            }
        }

        #endregion

        #region Inbound JSON Parsing

        private static OrderCmd ParseOrderCmd(string json)
        {
            return new OrderCmd
            {
                id          = Json.ReadString(json, "id"),
                instance_id = Json.ReadString(json, "instance_id"),
                algo_id     = Json.ReadString(json, "algo_id"),
                action      = Json.ReadString(json, "action"),
                symbol      = Json.ReadString(json, "symbol"),
                qty         = Json.ReadInt(json, "qty"),
                order_type  = Json.ReadString(json, "order_type"),
                limit_price = Json.ReadDouble(json, "limit_price"),
                stop_price  = Json.ReadDouble(json, "stop_price"),
            };
        }

        private static ModifyCmd ParseModifyCmd(string json)
        {
            return new ModifyCmd
            {
                order_id    = Json.ReadString(json, "order_id"),
                qty         = Json.ReadInt(json, "qty"),
                limit_price = Json.ReadDouble(json, "limit_price"),
                stop_price  = Json.ReadDouble(json, "stop_price"),
            };
        }

        private static BracketCmd ParseBracketCmd(string json)
        {
            return new BracketCmd
            {
                id          = Json.ReadString(json, "id"),
                instance_id = Json.ReadString(json, "instance_id"),
                algo_id     = Json.ReadString(json, "algo_id"),
                symbol      = Json.ReadString(json, "symbol"),
                entry       = ParseBracketLeg(json, "entry"),
                stop_loss   = ParseBracketLeg(json, "stop_loss"),
                take_profit = ParseBracketLeg(json, "take_profit"),
            };
        }

        private static BracketLegCmd ParseBracketLeg(string json, string legName)
        {
            // Find the nested object for this leg
            string key = "\"" + legName + "\"";
            int keyIdx = json.IndexOf(key, StringComparison.Ordinal);
            if (keyIdx < 0) return new BracketLegCmd { order_type = "MARKET" };

            int braceStart = json.IndexOf('{', keyIdx + key.Length);
            if (braceStart < 0) return new BracketLegCmd { order_type = "MARKET" };

            // Find matching closing brace
            int depth = 1;
            int braceEnd = braceStart + 1;
            while (braceEnd < json.Length && depth > 0)
            {
                if (json[braceEnd] == '{') depth++;
                else if (json[braceEnd] == '}') depth--;
                braceEnd++;
            }

            string legJson = json.Substring(braceStart, braceEnd - braceStart);

            return new BracketLegCmd
            {
                action      = Json.ReadStringOrNull(legJson, "action"),
                order_type  = Json.ReadString(legJson, "order_type") ?? "MARKET",
                qty         = Json.ReadIntOrNull(legJson, "qty"),
                limit_price = Json.ReadDoubleOrNull(legJson, "limit_price"),
                stop_price  = Json.ReadDoubleOrNull(legJson, "stop_price"),
            };
        }

        #endregion

        #region Strategy Parameters

        [NinjaScriptProperty]
        [Display(Name = "Wolf Den Endpoint", Description = "Remote WebSocket URL (e.g. ngrok). Leave blank to use localhost + port.", Order = 1, GroupName = "Wolf Den")]
        public string WolfDenEndpoint { get; set; }

        [NinjaScriptProperty]
        [Range(1, int.MaxValue)]
        [Display(Name = "Wolf Den Port", Description = "Local WebSocket server port (ignored if Endpoint is set)", Order = 2, GroupName = "Wolf Den")]
        public int WolfDenPort { get; set; }

        [NinjaScriptProperty]
        [Range(1, 60)]
        [Display(Name = "Heartbeat Seconds", Description = "Heartbeat interval in seconds", Order = 3, GroupName = "Wolf Den")]
        public int HeartbeatSeconds { get; set; }

        [NinjaScriptProperty]
        [Range(1, 60)]
        [Display(Name = "Reconnect Seconds", Description = "Initial reconnect delay in seconds", Order = 4, GroupName = "Wolf Den")]
        public int ReconnectSeconds { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Auto Reconnect", Description = "Automatically reconnect on disconnect", Order = 5, GroupName = "Wolf Den")]
        public bool AutoReconnect { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Send Ticks", Description = "Forward tick data to Wolf Den", Order = 6, GroupName = "Wolf Den")]
        public bool SendTicks { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Send Bars", Description = "Forward bar data to Wolf Den", Order = 7, GroupName = "Wolf Den")]
        public bool SendBars { get; set; }

        #endregion
    }

    #region Minimal JSON Helpers (no external dependencies)

    internal static class Json
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>Builds a flat JSON object from key-value pairs.</summary>
        public static string Build(params object[] kvPairs)
        {
            var sb = new StringBuilder(256);
            sb.Append('{');
            for (int i = 0; i < kvPairs.Length; i += 2)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append((string)kvPairs[i]).Append("\":");
                AppendValue(sb, kvPairs[i + 1]);
            }
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Appends a key:value pair with trailing comma to an existing StringBuilder.</summary>
        public static void Append(StringBuilder sb, string key, object value)
        {
            sb.Append('"').Append(key).Append("\":");
            AppendValue(sb, value);
            sb.Append(',');
        }

        private static void AppendValue(StringBuilder sb, object value)
        {
            if (value == null)
            {
                sb.Append("null");
            }
            else if (value is string s)
            {
                sb.Append('"').Append(EscapeString(s)).Append('"');
            }
            else if (value is double d)
            {
                sb.Append(d.ToString("R", Inv));
            }
            else if (value is int i)
            {
                sb.Append(i.ToString(Inv));
            }
            else if (value is long l)
            {
                sb.Append(l.ToString(Inv));
            }
            else if (value is bool b)
            {
                sb.Append(b ? "true" : "false");
            }
            else
            {
                sb.Append('"').Append(EscapeString(value.ToString())).Append('"');
            }
        }

        private static string EscapeString(string s)
        {
            if (s.IndexOfAny(new[] { '"', '\\', '\n', '\r', '\t' }) < 0) return s;

            var sb = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"':  sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n");  break;
                    case '\r': sb.Append("\\r");  break;
                    case '\t': sb.Append("\\t");  break;
                    default:   sb.Append(c);      break;
                }
            }
            return sb.ToString();
        }

        // --- Reading values from JSON strings ---

        public static string ReadString(string json, string key)
        {
            string token = "\"" + key + "\"";
            int idx = json.IndexOf(token, StringComparison.Ordinal);
            if (idx < 0) return null;

            int colonIdx = json.IndexOf(':', idx + token.Length);
            if (colonIdx < 0) return null;

            // Skip whitespace after colon
            int valStart = colonIdx + 1;
            while (valStart < json.Length && json[valStart] == ' ') valStart++;

            if (valStart >= json.Length) return null;

            // Check for null
            if (json[valStart] == 'n') return null;

            // Must be a quoted string
            if (json[valStart] != '"') return null;

            int strStart = valStart + 1;
            var sb = new StringBuilder();
            for (int i = strStart; i < json.Length; i++)
            {
                if (json[i] == '\\' && i + 1 < json.Length)
                {
                    char next = json[i + 1];
                    switch (next)
                    {
                        case '"':  sb.Append('"');  break;
                        case '\\': sb.Append('\\'); break;
                        case 'n':  sb.Append('\n'); break;
                        case 'r':  sb.Append('\r'); break;
                        case 't':  sb.Append('\t'); break;
                        default:   sb.Append(next); break;
                    }
                    i++;
                }
                else if (json[i] == '"')
                {
                    return sb.ToString();
                }
                else
                {
                    sb.Append(json[i]);
                }
            }
            return sb.ToString();
        }

        public static string ReadStringOrNull(string json, string key)
        {
            return ReadString(json, key);
        }

        public static double ReadDouble(string json, string key)
        {
            string raw = ReadRawValue(json, key);
            if (raw == null || raw == "null") return 0;
            double result;
            double.TryParse(raw, NumberStyles.Float, Inv, out result);
            return result;
        }

        public static double? ReadDoubleOrNull(string json, string key)
        {
            string raw = ReadRawValue(json, key);
            if (raw == null || raw == "null") return null;
            double result;
            if (double.TryParse(raw, NumberStyles.Float, Inv, out result))
                return result;
            return null;
        }

        public static int ReadInt(string json, string key)
        {
            string raw = ReadRawValue(json, key);
            if (raw == null || raw == "null") return 0;
            int result;
            int.TryParse(raw, NumberStyles.Integer, Inv, out result);
            return result;
        }

        public static int? ReadIntOrNull(string json, string key)
        {
            string raw = ReadRawValue(json, key);
            if (raw == null || raw == "null") return null;
            int result;
            if (int.TryParse(raw, NumberStyles.Integer, Inv, out result))
                return result;
            return null;
        }

        private static string ReadRawValue(string json, string key)
        {
            string token = "\"" + key + "\"";
            int idx = json.IndexOf(token, StringComparison.Ordinal);
            if (idx < 0) return null;

            int colonIdx = json.IndexOf(':', idx + token.Length);
            if (colonIdx < 0) return null;

            int valStart = colonIdx + 1;
            while (valStart < json.Length && json[valStart] == ' ') valStart++;

            if (valStart >= json.Length) return null;

            // If it's a quoted string, read until closing quote
            if (json[valStart] == '"')
            {
                int strStart = valStart + 1;
                int strEnd = json.IndexOf('"', strStart);
                return strEnd >= 0 ? json.Substring(strStart, strEnd - strStart) : null;
            }

            // Numeric, boolean, or null — read until delimiter
            int valEnd = valStart;
            while (valEnd < json.Length && json[valEnd] != ',' && json[valEnd] != '}' && json[valEnd] != ']')
                valEnd++;

            return json.Substring(valStart, valEnd - valStart).Trim();
        }
    }

    #endregion

    #region WebSocket Client

    internal class WsClient : IDisposable
    {
        private ClientWebSocket                         _ws;
        private readonly ConcurrentQueue<string>        _sendQueue = new ConcurrentQueue<string>();
        private readonly Action<string>                 _log;
        private CancellationTokenSource                 _sendCts;
        private Task                                    _sendTask;

        public bool IsConnected
        {
            get { return _ws != null && _ws.State == WebSocketState.Open; }
        }

        public WsClient(Action<string> log)
        {
            _log = log;
        }

        public async Task ConnectAsync(string uri, CancellationToken token)
        {
            Dispose();
            _ws = new ClientWebSocket();
            _ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(10);
            await _ws.ConnectAsync(new Uri(uri), token);

            _sendCts = CancellationTokenSource.CreateLinkedTokenSource(token);
            _sendTask = Task.Run(() => SendLoopAsync(_sendCts.Token), _sendCts.Token);
        }

        public void Send(string json)
        {
            _sendQueue.Enqueue(json);
        }

        public async Task<string> ReceiveAsync(CancellationToken token)
        {
            var buffer = new byte[65536];
            var sb = new StringBuilder();

            try
            {
                while (!token.IsCancellationRequested)
                {
                    var segment = new ArraySegment<byte>(buffer);
                    var result = await _ws.ReceiveAsync(segment, token);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        _log("Server closed connection");
                        return null;
                    }

                    sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                    if (result.EndOfMessage)
                    {
                        string msg = sb.ToString();
                        sb.Clear();
                        return msg;
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException ex)
            {
                _log("Receive error: " + ex.Message);
            }

            return null;
        }

        private async Task SendLoopAsync(CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested)
                {
                    string json;
                    if (_sendQueue.TryDequeue(out json))
                    {
                        var bytes = Encoding.UTF8.GetBytes(json);
                        var segment = new ArraySegment<byte>(bytes);
                        await _ws.SendAsync(segment, WebSocketMessageType.Text, true, token);
                    }
                    else
                    {
                        await Task.Delay(1, token);
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException ex)
            {
                _log("Send error: " + ex.Message);
            }
        }

        public void Dispose()
        {
            try { _sendCts?.Cancel(); } catch { }
            try
            {
                if (_ws != null && _ws.State == WebSocketState.Open)
                    _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Shutdown", CancellationToken.None)
                        .Wait(TimeSpan.FromSeconds(2));
            }
            catch { }
            try { _ws?.Dispose(); } catch { }
            try { _sendCts?.Dispose(); } catch { }
            _ws = null;
            _sendCts = null;
        }
    }

    #endregion

    #region Order Tracker

    internal class OrderTracker
    {
        private readonly ConcurrentDictionary<string, Order>    _idToOrder    = new ConcurrentDictionary<string, Order>();
        private readonly ConcurrentDictionary<Order, string>    _orderToId    = new ConcurrentDictionary<Order, string>();
        private readonly ConcurrentDictionary<string, string>   _idToInstance = new ConcurrentDictionary<string, string>();

        public void Track(string wolfDenId, string instanceId, Order ntOrder)
        {
            _idToOrder[wolfDenId] = ntOrder;
            _orderToId[ntOrder] = wolfDenId;
            if (!string.IsNullOrEmpty(instanceId))
                _idToInstance[wolfDenId] = instanceId;
        }

        public Order GetNtOrder(string wolfDenId)
        {
            Order order;
            return _idToOrder.TryGetValue(wolfDenId, out order) ? order : null;
        }

        public string GetWolfDenId(Order ntOrder)
        {
            string id;
            return _orderToId.TryGetValue(ntOrder, out id) ? id : null;
        }

        public string GetWolfDenIdBySignalName(string signalName)
        {
            Order order;
            return _idToOrder.TryGetValue(signalName, out order) ? signalName : null;
        }

        public string GetInstanceId(string wolfDenId)
        {
            string id;
            return _idToInstance.TryGetValue(wolfDenId, out id) ? id : null;
        }

        public void Remove(string wolfDenId)
        {
            Order order;
            if (_idToOrder.TryRemove(wolfDenId, out order))
            {
                string dummy;
                _orderToId.TryRemove(order, out dummy);
            }
            string dummy2;
            _idToInstance.TryRemove(wolfDenId, out dummy2);
        }
    }

    #endregion

    #region Command Models (Wolf Den -> NinjaTrader)

    internal class OrderCmd
    {
        public string id;
        public string instance_id;
        public string algo_id;
        public string action;
        public string symbol;
        public int qty;
        public string order_type;
        public double limit_price;
        public double stop_price;
    }

    internal class CancelCmd
    {
        public string order_id;
    }

    internal class ModifyCmd
    {
        public string order_id;
        public int qty;
        public double limit_price;
        public double stop_price;
    }

    internal class BracketCmd
    {
        public string id;
        public string instance_id;
        public string algo_id;
        public string symbol;
        public BracketLegCmd entry;
        public BracketLegCmd stop_loss;
        public BracketLegCmd take_profit;
    }

    internal class BracketLegCmd
    {
        public string action;
        public string order_type;
        public int? qty;
        public double? limit_price;
        public double? stop_price;
    }

    #endregion
}
