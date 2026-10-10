'use strict';
const {processSample} = require('./tracker.cjs');

// A generation invalidates queries started before pause, reset, lock or suspend.
class Collector {
  constructor({data, readWindow, readSystem, wallNow = Date.now, monotonicNow = () => performance.now()}) {
    Object.assign(this, {data, readWindow, readSystem, wallNow, monotonicNow});
    this.generation = 0;
    this.running = false;
    this.blocked = false;
    this.reset();
  }
  reset() { this.generation++; this.previous = null; this.currentApp = null; }
  async poll() {
    if (this.running || this.blocked || !this.data.settings.enabled) return false;
    this.running = true;
    const generation = this.generation;
    try {
      const info = await this.readWindow();
      if (generation !== this.generation || this.blocked || !this.data.settings.enabled) return false;
      const result = processSample(this.data, this.previous, {
        ...this.readSystem(), now:this.wallNow(), monotonic:this.monotonicNow(), appName:info?.owner?.name
      });
      this.previous = result.previous;
      this.currentApp = result.currentApp;
      return result.changed;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.reset();
      throw error;
    } finally { this.running = false; }
  }
}
module.exports = {Collector};
