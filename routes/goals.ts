import { Router } from 'express';

const router = Router();

// Goal endpoints - TODO: implement
router.get('/', (req, res) => {
  res.json({ message: 'Goals endpoint - coming soon' });
});

export default router;