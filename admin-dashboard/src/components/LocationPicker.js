import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { FiCrosshair, FiSearch } from 'react-icons/fi';

// Webpack rewrites Leaflet's default icon paths, so point them at the bundled images
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const GHANA_CENTER = [7.95, -1.03];
const PLACE_ZOOM = 18;

const styles = {
  wrap: { marginBottom: 12 },
  toolbar: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  searchForm: { display: 'flex', flex: 1, minWidth: 220, border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', background: '#fff' },
  searchInput: { flex: 1, border: 'none', padding: '9px 12px', fontSize: 14, outline: 'none' },
  searchBtn: { border: 'none', background: '#f0f3f5', padding: '0 12px', cursor: 'pointer', color: '#1a5276' },
  locateBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8,
    border: '1px solid #1a5276', background: '#fff', color: '#1a5276', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  results: { border: '1px solid #e0e0e0', borderRadius: 8, background: '#fff', marginBottom: 8, maxHeight: 180, overflow: 'auto' },
  resultItem: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, border: 'none', borderBottom: '1px solid #f5f5f5', background: '#fff', cursor: 'pointer' },
  map: { height: 340, borderRadius: 10, border: '1px solid #e0e0e0', zIndex: 0 },
  hint: { fontSize: 12, color: '#7f8c8d', marginTop: 6 },
};

function emitPoint(onChangeRef, latLng) {
  onChangeRef.current(latLng.lat.toFixed(6), latLng.lng.toFixed(6));
}

function parseCoord(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map for choosing an institution's location: click or drag the pin, search a
 * place, or use the browser's current position. Shows the geofence circle.
 */
export default function LocationPicker({ latitude, longitude, radius, onChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState('');

  onChangeRef.current = onChange;
  const lat = parseCoord(latitude);
  const lng = parseCoord(longitude);
  const hasPoint = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const radiusMeters = Math.max(10, parseInt(radius, 10) || 200);

  const emit = (latLng) => emitPoint(onChangeRef, latLng);

  // Create the map once
  useEffect(() => {
    // Reset layer refs in case a previous map instance was torn down (React strict mode)
    markerRef.current = null;
    circleRef.current = null;
    const map = L.map(containerRef.current, { center: GHANA_CENTER, zoom: 7 });
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri',
    });
    satellite.addTo(map);
    L.control.layers({ Satellite: satellite, Streets: streets }, null, { position: 'topright' }).addTo(map);

    map.on('click', (e) => emitPoint(onChangeRef, e.latlng));
    mapRef.current = map;

    return () => map.remove();
  }, []);

  // Keep the pin and geofence circle in sync with the form fields
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!hasPoint) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      if (circleRef.current) { circleRef.current.remove(); circleRef.current = null; }
      return;
    }

    const point = L.latLng(lat, lng);
    if (!markerRef.current) {
      markerRef.current = L.marker(point, { draggable: true }).addTo(map);
      markerRef.current.on('dragend', (e) => emitPoint(onChangeRef, e.target.getLatLng()));
      circleRef.current = L.circle(point, { radius: radiusMeters, color: '#1a5276', weight: 2, fillOpacity: 0.12 }).addTo(map);
      map.setView(point, Math.max(map.getZoom(), PLACE_ZOOM - 1));
    } else {
      markerRef.current.setLatLng(point);
      circleRef.current.setLatLng(point);
      circleRef.current.setRadius(radiusMeters);
      if (!map.getBounds().contains(point)) map.panTo(point);
    }
  }, [lat, lng, hasPoint, radiusMeters]);

  const flyTo = (latLng, zoom = PLACE_ZOOM) => {
    if (mapRef.current) mapRef.current.setView(latLng, zoom);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setStatus('This browser cannot share its location.');
      return;
    }
    setLocating(true);
    setStatus('Getting your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        emit(latLng);
        flyTo(latLng);
        setStatus(`Location found (accurate to about ${Math.round(pos.coords.accuracy)} m). Drag the pin to adjust.`);
        setLocating(false);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED
          ? 'Location permission was denied. Allow it in the browser, or pick the spot on the map.'
          : 'Could not get your location. Pick the spot on the map instead.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const search = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults([]);
    setStatus('');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=gh&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setStatus('No match found. Try the area name (e.g. "Golf City, Tema"), then click the building on the map.');
      } else if (data.length === 1) {
        flyTo([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        setStatus('Area found. Click the exact building to drop the pin.');
      } else {
        setResults(data);
      }
    } catch {
      setStatus('Search is unavailable right now. Zoom and click on the map instead.');
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r) => {
    setResults([]);
    flyTo([parseFloat(r.lat), parseFloat(r.lon)]);
    setStatus('Area found. Click the exact building to drop the pin.');
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        {/* Not a <form>: this sits inside the Create Institution form */}
        <div style={styles.searchForm}>
          <input
            style={styles.searchInput}
            placeholder="Search a place or area, e.g. Golf City, Tema"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(e); }}
          />
          <button type="button" style={styles.searchBtn} onClick={search} disabled={searching} title="Search">
            {searching ? '...' : <FiSearch size={16} />}
          </button>
        </div>
        <button type="button" style={styles.locateBtn} onClick={useCurrentLocation} disabled={locating}>
          <FiCrosshair size={14} /> {locating ? 'Locating...' : 'Use my current location'}
        </button>
      </div>

      {results.length > 0 && (
        <div style={styles.results}>
          {results.map((r) => (
            <button type="button" key={r.place_id} style={styles.resultItem} onClick={() => pickResult(r)}>
              {r.display_name}
            </button>
          ))}
        </div>
      )}

      <div ref={containerRef} style={styles.map} />

      <div style={styles.hint}>
        {status || 'Click the institution on the map (or drag the pin) to set its location. The circle shows the geofence radius.'}
      </div>
    </div>
  );
}
