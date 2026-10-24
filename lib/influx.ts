import { InfluxDB, WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { Logging } from './logging';

let influxDB: InfluxDB | null = null;
let queryApi: QueryApi | null = null;

/**
 * One write API per bucket. Each `getWriteApi()` call opens its own buffered
 * writer, so handing out a new one per caller meant several independent buffers
 * (and several flush timers) writing to the same bucket.
 */
const writeApis = new Map<string, WriteApi>();

const getInfluxDB = (): InfluxDB => {
  if (!influxDB) {
    influxDB = new InfluxDB({
      url: process.env.INFLUXDB_URL!,
      token: process.env.INFLUXDB_TOKEN!,
    });
  }
  return influxDB;
};

export const getWriteApi = (bucket: string): WriteApi => {
  const existing = writeApis.get(bucket);
  if (existing) return existing;

  const writeApi = getInfluxDB().getWriteApi(process.env.INFLUXDB_ORG!, bucket, 'ns', {
    // Points are batched instead of flushed per event; these bounds keep the
    // delay short without turning every message into an HTTP request.
    batchSize: 500,
    flushInterval: 10_000,
    maxRetries: 3,
  });

  writeApi.useDefaultTags({});
  writeApis.set(bucket, writeApi);

  return writeApi;
};

export const getQueryApi = (): QueryApi => {
  if (!queryApi) {
    queryApi = getInfluxDB().getQueryApi(process.env.INFLUXDB_ORG!);
  }
  return queryApi;
};

/** Flushes every buffered point. Called on shutdown so batching cannot lose data. */
export const flushInflux = async (): Promise<void> => {
  await Promise.all(
    [...writeApis.values()].map((api) =>
      api.flush().catch((error) => Logging.error(`Influx flush failed: ${error}`))
    )
  );
};
