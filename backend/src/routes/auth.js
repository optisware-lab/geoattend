const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticate, authenticateForRefresh, requireSuperAdmin } = require('../middleware/auth');

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/google', authController.googleAuth);
router.post('/google/complete', authController.completeGoogleSignup);
// Password reset: a code is emailed first, then the code sets the new password.
// Limited per account and IP so codes can't be guessed or emails spammed.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyGenerator: (req) => {
    const account = [req.body?.institutionCode, req.body?.staffId]
      .filter(Boolean).map((v) => String(v).trim().toUpperCase()).join(':');
    return account ? `${req.ip}|${account}` : req.ip;
  },
  message: { error: 'Too many tries. Please wait 15 minutes and try again.' },
});
router.post('/forgot-password/send-code', resetLimiter, authController.sendResetCode);
router.post('/forgot-password', resetLimiter, authController.forgotPassword);
router.post('/forgot-staff-id', authController.forgotStaffId);
router.post('/refresh-token', authenticateForRefresh, authController.refreshToken);
router.post('/push-token', authenticate, authController.savePushToken);
router.get('/profile', authenticate, authController.getProfile);
router.put('/change-password', authenticate, authController.changePassword);
router.post('/logout-other-devices', authenticate, authController.logoutOtherDevices);

// Super-admin helper: create initial admin for an institution
router.post('/create-initial-admin', authenticate, requireSuperAdmin, authController.createInitialAdmin);

module.exports = router;
