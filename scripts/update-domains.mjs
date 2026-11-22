import { database, loadData, saveData } from '../admin-store.js';
import { updateOrigins } from '../sources.js';

try { process.loadEnvFile?.(); } catch {}

const isaidub = process.argv[2] || 'https://isaidub.green';
const moviezda = process.argv[3] || 'https://moviesda36.com';

const client = database();
try {
  const d = await loadData(client, true);
  d.config = d.config || {};
  d.config.isaidub_url = isaidub;
  d.config.moviezda_url = moviezda;
  await saveData(d);
  console.log('Successfully updated Neon database settings:');
  console.log('- Isaidub URL:', isaidub);
  console.log('- Moviezda URL:', moviezda);
} catch (e) {
  console.error('Error updating settings in DB:', e.message);
} finally {
  await client.end();
}
