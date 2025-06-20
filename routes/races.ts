import { Router } from 'express';

const router = Router();

// Race endpoints - TODO: implement
router.get('/', (req, res) => {
  res.json({ message: 'Races endpoint - coming soon' });
});

export default router;