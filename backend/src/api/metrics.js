import { Router } from 'express';
import { getDashboardStats, getMetrics } from '../services/metrics.js';

const router = Router();

// GET /api/metrics/dashboard - full dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/metrics/hourly?hours=24
router.get('/hourly', async (req, res) => {
  try {
    const metrics = await getMetrics(req.query.hours || 24);
    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
