export default function handler(req, res) {
  res.json({ backendUrl: (process.env.ORACLE_BACKEND_URL || '').replace(/\/$/, '') });
}
