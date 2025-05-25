import { v1 as places } from '@googlemaps/places';

let placesClient: places.PlacesClient | undefined = undefined;

export async function getLocation(
  handle: string,
  address: string
): Promise<{ lat: number; lng: number } | null> {
  console.log(`Geocoding: ${handle}`);
  if (placesClient == null) {
    placesClient = new places.PlacesClient({
      apiKey: process.env.SERVER_GOOGLE_API_KEY,
    });
  }
  const result = await placesClient.searchText(
    {
      regionCode: 'nz',
      textQuery: address,
    },
    {
      otherArgs: {
        headers: {
          'X-Goog-FieldMask': 'places.location',
        },
      },
    }
  );
  const location = result[0]?.places?.[0]?.location;
  console.log(`Location ${location ? 'Found' : 'Not Found'}`);
  return location
    ? {
        lat: location.latitude as number,
        lng: location.longitude as number,
      }
    : null;
}
