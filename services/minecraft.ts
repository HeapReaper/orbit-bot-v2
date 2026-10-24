import { status } from 'minecraft-server-util';
import { Logging } from '../lib/logging';

export async function getMinecraftServer(host: string, port: number = 25565) {
  try {
    const res = await status(host, port, { timeout: 5000 });

    const cleanMotd = Array.isArray(res.motd.clean) ? res.motd.clean.join('\n') : res.motd.clean;

    return {
      online: res.players.online,
      max: res.players.max,
      list: res.players.sample?.map((p) => p.name) || [],
      version: res.version.name,
      motd: cleanMotd,
      favicon: res.favicon, // base64 png
    };
  } catch (err) {
    Logging.debug(`Minecraft status error for ${host}:${port}: ${err}`);
    return null;
  }
}
