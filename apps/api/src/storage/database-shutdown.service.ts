import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { DATABASE_CLIENT, DatabaseClient } from "./database.pool";

@Injectable()
export class DatabaseShutdownService implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
