export default function handler(req, res) {
  res.json({ backendUrl: (process.env.BACKEND_URL || '').replace(/\/$/, '') });
}
