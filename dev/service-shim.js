// Stands in for Qollab's Python bridge during local development: each export
// mimics a Pyodide function proxy with a .callPromising() method.
function remote(name) {
  return {
    async callPromising(...args) {
      const res = await fetch(`/api/${name}`, { method: 'POST', body: JSON.stringify(args) });
      if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
      return res.text();
    },
  };
}

export const list_presets = remote('list_presets');
export const get_trace = remote('get_trace');
export const trace_qasm = remote('trace_qasm');
