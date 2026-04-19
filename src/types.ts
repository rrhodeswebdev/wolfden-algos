export type Algo = {
  id: number;
  name: string;
  code: string;
  config: string | null;
  dependencies: string;
  deps_hash: string;
  created_at: string;
  updated_at: string;
};

export type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
  account: string;
  data_source_id: string;
  instance_id: string;
};

export type View = "home" | "editor" | "algos" | "trading";

export type NavOptions = {
  accountFilter?: string;
  algoFilter?: number;
  instanceId?: string;
  scrollTo?: "positions" | "orders" | "history" | "stats";
};

export type NavContext = NavOptions & { targetView: View };
