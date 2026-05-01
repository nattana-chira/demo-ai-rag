import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private client: RedisClientType | null = null;
  private isReady = false;

  async onModuleDestroy() {
    if (this.client && this.isReady) {
      await this.client.quit();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.getString(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.setString(key, JSON.stringify(value), ttlSeconds);
  }

  async getString(key: string): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;
    return client.get(key);
  }

  async setString(key: string, value: string, ttlSeconds: number): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    await client.set(key, value, { EX: ttlSeconds });
  }

  private async getClient(): Promise<RedisClientType | null> {
    if (this.client && this.isReady) {
      return this.client;
    }

    if (!this.client) {
      const host = process.env.REDIS_HOST ?? '127.0.0.1';
      const port = Number(process.env.REDIS_PORT ?? 6379);
      const password = process.env.REDIS_PASSWORD;
      const url = password
        ? `redis://:${password}@${host}:${port}`
        : `redis://${host}:${port}`;

      this.client = createClient({ url });
      this.client.on('error', (error) => {
        console.log('[RedisCacheService] Redis unavailable:', error.message);
        this.isReady = false;
      });
    }

    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      this.isReady = true;
      return this.client;
    } catch (error) {
      console.log('[RedisCacheService] Failed to connect Redis');
      this.isReady = false;
      return null;
    }
  }
}
