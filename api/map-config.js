// Maps JavaScript keys are public by design; restrict them by HTTP referrer in Google Cloud.
export function GET() {
  return Response.json({ googleMapsKey: process.env.SISMOS_GOOGLE_MAPS_KEY || null }, { headers: { 'Cache-Control': 'no-store' } });
}
