import {bytes} from './model.mjs';

export function detailed(sample) {
  return sample?.processDetailsVersion === 2 && Array.isArray(sample.applications);
}

export function processRows(sample) {
  if (detailed(sample)) return sample.applications.flatMap(group => group.processes);
  return [...new Map([...(sample?.topMemory || []), ...(sample?.topCpu || [])].map(row => [row.pid, row])).values()];
}

export function memoryValue(row, metric) {
  if (metric === 'working') return row.memory;
  if (Number.isFinite(row.privateMemory)) return row.privateMemory;
  return row.privateMemoryKnown > 0 ? row.knownPrivateMemory : -1;
}

export function memoryText(row, metric) {
  if (metric === 'working') return bytes(row.memory);
  if (Number.isFinite(row.privateMemory)) return bytes(row.privateMemory);
  if (row.privateMemoryKnown > 0) return bytes(row.knownPrivateMemory) + '（部分 ' + row.privateMemoryKnown + '/' + row.processCount + '）';
  return '不可用';
}

export function rankedRows(sample, {mode = 'apps', metric = 'private', sort = 'memory', query = ''} = {}) {
  const source = mode === 'apps' && detailed(sample) ? sample.applications : processRows(sample);
  const needle = query.trim().toLowerCase();
  const filtered = source.filter(row => !needle || [row.name, row.pid ?? row.rootPid, row.role || '', ...(row.processes || []).map(p => p.name + ' ' + p.pid)].join(' ').toLowerCase().includes(needle));
  return [...filtered].sort((a, b) => {
    const delta = sort === 'cpu' ? b.cpu - a.cpu : memoryValue(b, metric) - memoryValue(a, metric);
    return delta || String(a.id ?? a.pid).localeCompare(String(b.id ?? b.pid));
  }).slice(0, 20);
}
