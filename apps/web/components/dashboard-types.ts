export type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};
