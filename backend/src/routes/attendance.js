const router = require('express').Router();
const multer = require('multer');
const attendanceController = require('../controllers/attendanceController');
const { authenticate } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(authenticate, requireActiveSubscription);

const qrImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG or WebP images are accepted'));
  },
});

router.post('/check-in', attendanceController.checkIn);
router.post('/check-in-from-image', qrImageUpload.single('image'), attendanceController.checkInFromImage);
router.post('/check-out', attendanceController.checkOut);
router.get('/my-attendance', attendanceController.getMyAttendance);
router.get('/today', attendanceController.getTodayStatus);
router.get('/weekly-stats', attendanceController.getWeeklyStats);

// Map multer errors to JSON the app can display
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 8MB)' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err) {
    console.error('Attendance upload error:', err.message);
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
  return next();
});

module.exports = router;
