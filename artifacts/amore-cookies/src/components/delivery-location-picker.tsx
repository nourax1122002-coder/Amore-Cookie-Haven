import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, Crosshair, MapPin, RefreshCw } from 'lucide-react';
export { parseCoordinate } from './delivery-coordinates';

export type DeliveryCoordinates = { latitude: number; longitude: number };
type Lang = 'ar' | 'en';

/** Small local tile provider config. Only https URLs on allow-listed hosts are accepted. */
export const MAP_TILE_CONFIG = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attributionHtml: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  maxZoom: 19,
  referrerPolicy: 'strict-origin-when-cross-origin' as const,
  reportIssueUrl: 'https://www.openstreetmap.org/fixthemap',
  allowedHosts: ['tile.openstreetmap.org'],
};
const KUWAIT_CENTER: L.LatLngTuple = [29.3117, 47.4818];
const KUWAIT_ZOOM = 9;

function safeTileUrl(url: string): string | null {
  try {
    const u = new URL(url.replace(/\{[a-z]\}/g, '0'));
    if (u.protocol === 'https:' && !u.username && !u.password && MAP_TILE_CONFIG.allowedHosts.includes(u.hostname)) return url;
  } catch { /* fall through */ }
  return null;
}
const fmt = (n: number) => n.toFixed(6);

const markerIcon = L.divIcon({
  className: 'amore-map-pin',
  html: '<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 1C8.2 1 1 8 1 16.7 1 28.5 17 43 17 43s16-14.5 16-26.3C33 8 25.8 1 17 1z" fill="#5B0D1E" stroke="#fffaf8" stroke-width="2"/><circle cx="17" cy="16.5" r="6" fill="#FFD6E5"/></svg>',
  iconSize: [34, 44],
  iconAnchor: [17, 43],
});

const T = {
  ar: {
    title: 'موقع التوصيل', help: 'اضغطي على الخريطة لوضع الدبوس، اسحبيه لضبط الموقع، ثم أكّدي الموقع.',
    useMine: 'استخدم موقعي الحالي', locating: 'جارٍ تحديد موقعك…', lat: 'خط العرض', lng: 'خط الطول',
    apply: 'عرض الإحداثيات على الخريطة', confirm: 'تأكيد هذا الموقع', confirmed: 'تم تأكيد الموقع', change: 'تغيير الموقع',
    clear: 'مسح', none: 'لم يتم اختيار موقع بعد.', pending: 'موقع مختار وغير مؤكد بعد. أكّديه للمتابعة.',
    badLat: 'أدخلي خط عرض صحيحاً بين -90 و 90.', badLng: 'أدخلي خط طول صحيحاً بين -180 و 180.',
    unsupported: 'المتصفح لا يدعم تحديد الموقع. اختاري موقعك على الخريطة.',
    insecure: 'تحديد الموقع يتطلب اتصالاً آمناً (HTTPS). اختاري موقعك على الخريطة.',
    denied: 'تم رفض إذن الموقع، أو أن الصفحة معروضة داخل إطار لا يسمح بذلك. اختاري موقعك على الخريطة يدوياً.',
    unavailable: 'تعذر تحديد موقعك حالياً. اختاري موقعك على الخريطة.',
    timeout: 'انتهت مهلة تحديد الموقع. حاولي مجدداً أو اختاري الموقع يدوياً.',
    tiles: 'تعذر تحميل بعض أجزاء الخريطة. يمكنك إعادة المحاولة.', retry: 'إعادة تحميل الخريطة',
    privacy: 'تُحمّل الخريطة من OpenStreetMap، فيرى مزودها المنطقة المعروضة واتصال متصفحك. لا نرسل عنوانك أو هاتفك إليه.',
    report: 'الإبلاغ عن خطأ في الخريطة', mapLabel: 'خريطة لاختيار موقع التوصيل',
  },
  en: {
    title: 'Delivery location', help: 'Tap the map to drop a pin, drag it to adjust, then confirm the location.',
    useMine: 'Use my current location', locating: 'Finding your location…', lat: 'Latitude', lng: 'Longitude',
    apply: 'Show coordinates on map', confirm: 'Confirm this location', confirmed: 'Location confirmed', change: 'Change location',
    clear: 'Clear', none: 'No location selected yet.', pending: 'Location selected but not confirmed. Confirm it to continue.',
    badLat: 'Enter a valid latitude between -90 and 90.', badLng: 'Enter a valid longitude between -180 and 180.',
    unsupported: 'This browser does not support location. Pick your spot on the map.',
    insecure: 'Location needs a secure (HTTPS) connection. Pick your spot on the map.',
    denied: 'Location permission was denied, or this page is embedded where location is blocked. Pick your spot on the map.',
    unavailable: 'Your location could not be determined. Pick your spot on the map.',
    timeout: 'Finding your location timed out. Try again or pick it manually.',
    tiles: 'Some map tiles failed to load. Please retry.', retry: 'Reload map',
    privacy: 'Map tiles load from OpenStreetMap, which sees the area viewed and your browser connection. Your address and phone are never sent to it.',
    report: 'Report a map issue', mapLabel: 'Map for choosing the delivery location',
  },
};

export function DeliveryLocationPicker({ lang, value, onChange }: {
  lang: Lang; value: DeliveryCoordinates | null; onChange: (value: DeliveryCoordinates | null) => void;
}) {
  const t = T[lang];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const mountedRef = useRef(true);
  const geoRequestRef = useRef(0);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const valueRef = useRef(value); valueRef.current = value;

  const [candidate, setCandidate] = useState<DeliveryCoordinates | null>(value);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);

  const isConfirmed = !!value && !!candidate && value.latitude === candidate.latitude && value.longitude === candidate.longitude;

  // Any candidate change invalidates prior confirmation.
  const setNewCandidate = useCallback((c: DeliveryCoordinates | null, pan = false) => {
    geoRequestRef.current++;
    setLocating(false);
    setCandidate(c);
    if (valueRef.current) onChangeRef.current(null);
    if (pan && c && mapRef.current) mapRef.current.setView([c.latitude, c.longitude], Math.max(mapRef.current.getZoom(), 16));
  }, []);
  const setNewCandidateRef = useRef(setNewCandidate); setNewCandidateRef.current = setNewCandidate;

  // External value sync (controlled prop).
  useEffect(() => {
    if (value && (!candidate || candidate.latitude !== value.latitude || candidate.longitude !== value.longitude)) {
      setCandidate(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.latitude, value?.longitude]);

  // Create the map once per mount (StrictMode-safe: cleanup removes it).
  useEffect(() => {
    mountedRef.current = true;
    const el = containerRef.current;
    if (!el) return;
    const start = valueRef.current;
    let initializingMap: L.Map | undefined;
    try {
    const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
      .setView(start ? [start.latitude, start.longitude] : KUWAIT_CENTER, start ? 16 : KUWAIT_ZOOM);
    initializingMap = map;
    map.attributionControl.setPrefix(false);
    const tileUrl = safeTileUrl(MAP_TILE_CONFIG.url);
    if (!tileUrl) setTileError(true);
    const tiles = L.tileLayer(tileUrl ?? '', {
      maxZoom: MAP_TILE_CONFIG.maxZoom,
      attribution: MAP_TILE_CONFIG.attributionHtml,
      referrerPolicy: MAP_TILE_CONFIG.referrerPolicy,
      crossOrigin: false,
    } as L.TileLayerOptions);
    if (tileUrl) tiles.addTo(map);
    tiles.on('tileerror', () => { if (mountedRef.current) setTileError(true); });
    map.on('click', (e: L.LeafletMouseEvent) => {
      const point = e.latlng.wrap();
      setNewCandidateRef.current({ latitude: +point.lat.toFixed(6), longitude: +point.lng.toFixed(6) });
    });
    mapRef.current = map; tileRef.current = tiles;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);
    return () => {
      mountedRef.current = false;
      geoRequestRef.current++;
      ro?.disconnect();
      tiles.off(); map.off(); map.remove();
      mapRef.current = null; tileRef.current = null; markerRef.current = null;
    };
    } catch {
      // A map failure must never remove the checkout.
      initializingMap?.remove();
      mapRef.current = null; tileRef.current = null; markerRef.current = null;
      setTileError(true);
      return () => { mountedRef.current = false; geoRequestRef.current++; };
    }
  }, [mapAttempt]);

  // Sync marker with candidate (no map recreation).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!candidate) { markerRef.current?.remove(); markerRef.current = null; return; }
    const ll: L.LatLngTuple = [candidate.latitude, candidate.longitude];
    if (!markerRef.current) {
      const m = L.marker(ll, { draggable: true, icon: markerIcon, keyboard: true, title: t.title, autoPan: true }).addTo(map);
      m.on('dragend', () => {
        const p = m.getLatLng().wrap();
        setNewCandidateRef.current({ latitude: +p.lat.toFixed(6), longitude: +p.lng.toFixed(6) });
      });
      markerRef.current = m;
    } else markerRef.current.setLatLng(ll);
  }, [candidate, t.title, mapAttempt]);

  const useMyLocation = () => {
    setGeoMsg(null);
    if (valueRef.current) onChangeRef.current(null);
    if (!window.isSecureContext) return setGeoMsg(t.insecure);
    if (!('geolocation' in navigator) || !navigator.geolocation) return setGeoMsg(t.unsupported);
    setLocating(true);
    const request = ++geoRequestRef.current;
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mountedRef.current || request !== geoRequestRef.current) return;
          setLocating(false);
          if (!Number.isFinite(pos.coords.latitude) || Math.abs(pos.coords.latitude) > 90
            || !Number.isFinite(pos.coords.longitude) || Math.abs(pos.coords.longitude) > 180) {
            setGeoMsg(t.unavailable); return;
          }
          setNewCandidate({ latitude: +pos.coords.latitude.toFixed(6), longitude: +pos.coords.longitude.toFixed(6) }, true);
        },
        (err) => {
          if (!mountedRef.current || request !== geoRequestRef.current) return;
          setLocating(false);
          setGeoMsg(err.code === 1 ? t.denied : err.code === 3 ? t.timeout : t.unavailable);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    } catch {
      setLocating(false); setGeoMsg(t.denied);
    }
  };
  const retryTiles = () => {
    setTileError(false);
    if (!mapRef.current) { setMapAttempt(attempt => attempt + 1); return; }
    tileRef.current?.redraw(); mapRef.current.invalidateSize();
  };

  return (
    <section className="card-surface p-4 sm:p-5" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="delivery-location-title" data-testid="delivery-location-picker">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="delivery-location-title" className="flex items-center gap-2 text-sm font-semibold text-[#5B0D1E]"><MapPin size={16} />{t.title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#896a71]">{t.help}</p>
        </div>
        <button type="button" onClick={useMyLocation} disabled={locating} className="btn-outline !py-2.5 !px-4 disabled:opacity-60" data-testid="button-use-current-location">
          <Crosshair size={14} />{locating ? t.locating : t.useMine}
        </button>
      </div>
      {geoMsg && <p role="alert" className="mt-3 rounded-xl bg-[#fff1f3] px-3 py-2 text-xs text-[#763246]" data-testid="text-geo-error">{geoMsg}</p>}

      <div className="relative isolate z-0 mt-4 overflow-hidden rounded-2xl border border-[#efdee2] bg-[#f8e8ec]">
        <div ref={containerRef} role="application" aria-label={t.mapLabel} className="h-[300px] sm:h-[360px] w-full touch-pan-y" dir="ltr" data-testid="map-delivery" />
        {tileError && (
          <div role="alert" className="absolute inset-x-2 bottom-8 z-[1000] flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#fffaf8]/95 px-3 py-2 text-xs text-[#763246] shadow">
            <span>{t.tiles}</span>
            <button type="button" onClick={retryTiles} className="inline-flex items-center gap-1 font-bold underline" data-testid="button-retry-tiles"><RefreshCw size={12} />{t.retry}</button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#fbf1f3] px-3 py-3" aria-live="polite">
        <p className="text-xs text-[#5B0D1E]" data-testid="status-location">
          {isConfirmed ? <span className="inline-flex items-center gap-1.5 font-semibold"><Check size={14} />{t.confirmed}</span> : candidate ? t.pending : t.none}
          {candidate && <span dir="ltr" className="ms-2 font-mono text-[11px] text-[#896a71]">{fmt(candidate.latitude)}, {fmt(candidate.longitude)}</span>}
        </p>
        <div className="flex gap-2">
          {candidate && <button type="button" onClick={() => setNewCandidate(null)} className="text-xs font-semibold text-[#896a71] underline" data-testid="button-clear-location">{t.clear}</button>}
          {candidate && !isConfirmed && <button type="button" disabled={locating} onClick={() => onChange(candidate)} className="btn-primary !py-2.5 disabled:opacity-50" data-testid="button-confirm-location"><Check size={14} />{t.confirm}</button>}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-[#8b6870]">{t.privacy}{' '}
        <a href={MAP_TILE_CONFIG.reportIssueUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="underline" data-testid="link-report-map-issue">{t.report}</a>
      </p>
    </section>
  );
}

export default DeliveryLocationPicker;
