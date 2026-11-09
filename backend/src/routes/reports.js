const router = require('express').Router();
const reportController = require('../controllers/reportController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(authenticate, requireActiveSubscription, requireAdmin);

router.get('/dashboard', reportController.getDashboardStats);
router.get('/today-summary', reportController.getTodaySummary);
router.get('/attendance', reportController.getAttendanceReport);
router.get('/realtime', reportController.getRealTimeAttendance);
router.get('/weekly-summary', reportController.getWeeklySummary);
router.get('/weekly-breakdown', reportController.getWeeklyBreakdown);
router.get('/fraud', reportController.getFraudReport);
router.get('/geofence-events', reportController.getGeofenceEvents);
router.get('/export/excel', reportController.exportExcel);
router.get('/export/pdf', reportController.exportPDF);

module.exports = router;
