/**
 * ICE server list (STUN + TURN) with short-lived TURN credentials.
 *
 * Coturn must run with `use-auth-secret` and the same `static-auth-secret`
 * as TURN_SECRET here. Credentials follow the coturn REST API convention:
 *   username = <expiryUnixTimestamp>:<userId>
 *   credential = base64(HMAC-SHA1(secret, username))
 */
import { createHmac } from 'node:crypto';
import { config } from './config.js';

export function iceServers(userId = '') {
  const servers = [];
  const stun = config.turnUrls.filter((u) => u.startsWith('stun'));
  if (stun.length) servers.push({ urls: stun });

  if (config.turnSecret && config.turnHost) {
    const ttl = config.turnCredentialTtl;
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId || 'masingar'}`;
    const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64');
    const urls = [
      `turn:${config.turnHost}:${config.turnTcpPort}?transport=tcp`, // TCP 443: works behind strict firewalls / 2G proxies
      `turn:${config.turnHost}:${config.turnPort}?transport=udp`,
      `turn:${config.turnHost}:${config.turnTlsPort}?transport=tcp`, // TLS
      `turns:${config.turnHost}:${config.turnTlsPort}?transport=tcp`,
    ];
    servers.push({ urls, username, credential });
  } else if (config.freeTurn) {
    /**
     * Zero-cost fallback relay (Open Relay, a free community TURN service by
     * Metered) so voice/video calls connect out of the box - even behind
     * symmetric NATs and strict carriers - without deploying coturn first.
     * For production control run your own coturn (deploy/coturn) with
     * TURN_SECRET + TURN_HOST above; set FREE_TURN=false to disable this.
     */
    servers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  return servers;
}
