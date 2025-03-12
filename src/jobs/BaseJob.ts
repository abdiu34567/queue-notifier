export abstract class BaseJob<TPayload = any> {
  abstract type: string;
  payload: TPayload;

  constructor(payload: TPayload) {
    this.payload = payload; // ✅ Now valid
  }

  abstract execute(): Promise<void>;
}
