// Runs the Knox Monte Carlo test off the main thread so the map stays responsive.
import { knoxTest } from '../lib/knox.js'

self.onmessage = (e) => {
  const { id, points, options } = e.data
  try {
    self.postMessage({ id, result: knoxTest(points, options) })
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) })
  }
}
