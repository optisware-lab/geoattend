import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { institutionLogoUrl } from '../services/api';

// Fetched again on each app start, so a new logo shows the next time staff
// open the app (and on pull-to-refresh, which changes `refreshKey`).
const SESSION = Date.now();

/** The institution's logo; renders nothing when the school has none. */
export default function InstitutionLogo({ institutionId, size = 56, style, refreshKey = 0 }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => { setMissing(false); }, [institutionId, refreshKey]);
  if (!institutionId || missing) return null;
  return (
    <Image
      source={{ uri: `${institutionLogoUrl(institutionId)}?v=${SESSION}-${refreshKey}` }}
      onError={() => setMissing(true)}
      resizeMode="contain"
      accessibilityLabel="School logo"
      style={[{ width: size, height: size, borderRadius: 10 }, style]}
    />
  );
}
