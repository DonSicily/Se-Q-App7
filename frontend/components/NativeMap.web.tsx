import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface NativeMapProps {
  region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  markerCoords?: {
    latitude: number;
    longitude: number;
  };
  markers?: Array<{
    id: string;
    latitude: number;
    longitude: number;
    title?: string;
    description?: string;
    pinColor?: string;
  }>;
  radiusKm?: number;
  onPress?: (coords: { latitude: number; longitude: number }) => void;
  onMarkerChange?: (coords: { latitude: number; longitude: number }) => void;
  style?: any;
}

// Web version using Leaflet iframe for full map functionality
export function NativeMap({ region, markerCoords, markers, radiusKm, onPress, style }: NativeMapProps) {
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const lat = markerCoords?.latitude ?? region.latitude;
  const lng = markerCoords?.longitude ?? region.longitude;

  const allMarkers = markers ? markers : (markerCoords ? [{
    id: 'main', latitude: lat, longitude: lng, title: 'Selected Location', pinColor: '#EF4444'
  }] : []);

  const markersJson = JSON.stringify(allMarkers);
  const radiusMeters = radiusKm ? radiusKm * 1000 : 0;

  const leafletHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    * { margin:0; padding:0; box-sizing: border-box; }
    html, body, #map { width:100%; height:100%; background:#0F172A; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map', {zoomControl: true}).setView([${region.latitude}, ${region.longitude}], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);
    
    var markersData = ${markersJson};
    var leafletMarkers = [];
    
    markersData.forEach(function(m) {
      var color = m.pinColor || '#EF4444';
      var icon = L.divIcon({
        html: '<div style="background:' + color + ';width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      var marker = L.marker([m.latitude, m.longitude], {icon: icon, draggable: true}).addTo(map);
      if (m.title) {
        marker.bindPopup('<b>' + m.title + '</b>' + (m.description ? '<br>' + m.description : ''));
      }
      marker.on('dragend', function(e) {
        var ll = e.target.getLatLng();
        window.parent.postMessage(JSON.stringify({type: 'markerDrag', lat: ll.lat, lng: ll.lng}), '*');
      });
      leafletMarkers.push(marker);
    });
    
    ${radiusMeters > 0 && allMarkers.length > 0 ? `
    var radiusCircle = L.circle([${lat}, ${lng}], {
      radius: ${radiusMeters},
      color: '#3B82F6',
      fillColor: '#3B82F6',
      fillOpacity: 0.15,
      weight: 2
    }).addTo(map);
    ` : ''}
    
    map.on('click', function(e) {
      window.parent.postMessage(JSON.stringify({type: 'mapClick', lat: e.latlng.lat, lng: e.latlng.lng}), '*');
      if (leafletMarkers.length > 0) {
        leafletMarkers[0].setLatLng(e.latlng);
        ${radiusMeters > 0 ? 'if (radiusCircle) radiusCircle.setLatLng(e.latlng);' : ''}
      }
    });
    
    // Fit bounds to show all markers
    if (markersData.length > 1) {
      var bounds = L.latLngBounds(markersData.map(function(m) { return [m.latitude, m.longitude]; }));
      map.fitBounds(bounds, { padding: [30, 30] });
    }
    
    window.parent.postMessage(JSON.stringify({type: 'mapReady'}), '*');
  </script>
</body>
</html>
  `;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'mapReady') {
          setIsLoading(false);
        } else if ((data.type === 'mapClick' || data.type === 'markerDrag') && onPress) {
          onPress({ latitude: data.lat, longitude: data.lng });
        }
      } catch (e) {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onPress]);

  const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(leafletHtml)}`;

  return (
    <View style={[styles.container, style]}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
      <iframe
        ref={iframeRef}
        src={dataUri}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          borderRadius: 12,
        }}
        title="Map"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#0F172A',
    minHeight: 300,
    borderRadius: 12,
    overflow: 'hidden',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: { color: '#94A3B8', marginTop: 12, fontSize: 14 },
});
