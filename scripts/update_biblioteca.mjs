import { readFile, writeFile } from 'node:fs/promises';

// Somente a rota pública; nunca consulta solicitações ou anexos privados.
const config = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const api = config.match(/ntApiUrl:\s*"(https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec)"/)?.[1];
if (!api) throw new Error('Endpoint público da biblioteca não configurado.');
let result;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const response = await fetch(api + '?route=nt.biblioteca', { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('Falha HTTP: ' + response.status);
    result = await response.json();
    if (result?.ok !== true || !Array.isArray(result.documentos)) throw new Error('Resposta pública inválida.');
    break;
  } catch (error) { if (attempt === 2) throw error; }
}
const documentos = result.documentos.map(d => {
  if (!d.id || !d.titulo || !['nota', 'portaria'].includes(d.categoria) || !/^https:\/\//.test(d.url)) {
    throw new Error('Documento público inválido; cópia anterior preservada.');
  }
  return Object.fromEntries(['id', 'titulo', 'categoria', 'numero', 'data', 'assunto', 'url'].map(k => [k, String(d[k] || '')]));
}).sort((a, b) => a.id.localeCompare(b.id));
const file = new URL('../biblioteca-publica.json', import.meta.url);
let previous;
try { previous = JSON.parse(await readFile(file, 'utf8')); } catch {}
if (JSON.stringify(previous?.documentos) !== JSON.stringify(documentos)) {
  await writeFile(file, JSON.stringify({ atualizadoEm: new Date().toISOString(), documentos }, null, 2) + '\n');
}
console.log(documentos.length + ' documentos públicos conferidos.');
