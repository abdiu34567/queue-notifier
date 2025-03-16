export abstract class BaseJob<TPayload = any> {
  abstract type: string;
  payload: TPayload;

  constructor(payload: TPayload) {
    this.payload = payload;
  }

  abstract execute(): Promise<void>;
}
