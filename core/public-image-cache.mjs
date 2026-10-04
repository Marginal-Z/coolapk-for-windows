// This cache is only for the public, credential-free official CDN reader.
// Account QR codes and private message images must never use it.
export class PublicImageCache {
  constructor(fetchImage, limit = 48 * 1024 * 1024) {
    this.fetchImage = fetchImage; this.limit = limit; this.entries = new Map(); this.pending = new Map(); this.bytes = 0; this.epoch = 0;
  }
  clear() { this.epoch++; this.entries.clear(); this.pending.clear(); this.bytes = 0; }
  get stats() { return { entries: this.entries.size, bytes: this.bytes }; }
  async read(source) {
    const cached = this.entries.get(source);
    if (cached) { this.entries.delete(source); this.entries.set(source, cached); return cached; }
    if (this.pending.has(source)) return this.pending.get(source);
    const epoch = this.epoch;
    const request = Promise.resolve().then(() => this.fetchImage(source)).then(result => {
      if (epoch === this.epoch && result.body.length <= this.limit) {
        while (this.bytes + result.body.length > this.limit && this.entries.size) {
          const oldest = this.entries.keys().next().value;
          this.bytes -= this.entries.get(oldest).body.length; this.entries.delete(oldest);
        }
        this.entries.set(source, result); this.bytes += result.body.length;
      }
      return result;
    }).finally(() => { if (this.pending.get(source) === request) this.pending.delete(source); });
    this.pending.set(source, request); return request;
  }
}
