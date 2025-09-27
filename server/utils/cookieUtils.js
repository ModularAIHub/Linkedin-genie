// Cookie utility functions for LinkedIn Genie (adapted from Tweet Genie)

/**
 * Get cookie options based on environment
 * @param {number} maxAge - Cookie expiration time in milliseconds
 * @returns {object} Cookie options object
 */
export function getCookieOptions(maxAge = 15 * 60 * 1000) {
  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge
  };
  if (isProduction) {
    options.domain = '.suitegenie.in';
  }
  return options;
}

/**
 * Get cookie clear options (used for logout)
 * @returns {object} Cookie clear options object
 */
export function getClearCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  };
  if (isProduction) {
    options.domain = '.suitegenie.in';
  }
  return options;
}

/**
 * Set authentication cookies with proper options
 * @param {object} res - Express response object
 * @param {string} accessToken - Access token to set
 * @param {string} refreshToken - Refresh token to set (optional)
 */
export function setAuthCookies(res, accessToken, refreshToken = null) {
  const accessTokenOptions = getCookieOptions(15 * 60 * 1000);
  res.cookie('accessToken', accessToken, accessTokenOptions);
  if (refreshToken) {
    const refreshTokenOptions = getCookieOptions(7 * 24 * 60 * 60 * 1000);
    res.cookie('refreshToken', refreshToken, refreshTokenOptions);
  }
}

/**
 * Clear authentication cookies
 * @param {object} res - Express response object
 */
export function clearAuthCookies(res) {
  const clearOptions = getClearCookieOptions();
  res.clearCookie('accessToken', clearOptions);
  res.clearCookie('refreshToken', clearOptions);
}
