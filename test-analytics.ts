import { AnalyticsService } from './services/analyticsService.js';
import { GeospatialService } from './services/geospatialService.js';
import { TrainingPlanService } from './services/trainingPlanService.js';

async function testServices() {
  console.log('🧪 Testing Analytics Service...');

  try {
    // Test basic analytics calculation
    const stats = await AnalyticsService.calculateStatistics(
      'test-user-id',
      new Date('2024-01-01'),
      new Date('2024-12-31')
    );
    console.log('✅ Analytics calculation works:', stats);

    // Test geospatial functions
    console.log('🗺️ Testing Geospatial Service...');

    const distance = GeospatialService.calculateDistance(
      { latitude: 40.7128, longitude: -74.006 }, // NYC
      { latitude: 40.7589, longitude: -73.9851 } // Times Square
    );
    console.log('✅ Distance calculation works:', distance, 'km');

    // Test route parsing
    const sampleRoute = JSON.stringify({
      type: 'LineString',
      coordinates: [
        [-74.006, 40.7128],
        [-73.9851, 40.7589],
        [-73.9857, 40.7614],
      ],
    });

    const parsedRoute = GeospatialService.parseRunRoute(sampleRoute);
    console.log('✅ Route parsing works:', parsedRoute?.coordinates.length, 'points');

    // Test elevation calculations
    const elevations = [100, 105, 110, 108, 115, 120];
    const elevationMetrics = GeospatialService.calculateElevationMetrics(elevations);
    console.log('✅ Elevation metrics work:', elevationMetrics);

    console.log('🎉 All services are working correctly!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testServices().catch(console.error);
}

export { testServices };
