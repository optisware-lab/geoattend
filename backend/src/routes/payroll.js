const router = require('express').Router();
const payrollController = require('../controllers/payrollController');
const { authenticate } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');
const { requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireActiveSubscription);

// Admin routes (institution-wide payroll review)
router.get('/summary', requireAdmin, payrollController.summary);
router.get('/summary.csv', requireAdmin, payrollController.summaryCsv);
router.get('/daily', requireAdmin, payrollController.daily);

// Staff route (own earnings)
router.get('/my-earnings', payrollController.myEarnings);

module.exports = router;
