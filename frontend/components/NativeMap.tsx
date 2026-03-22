import React, { useState } from 'react';
import { View, StyleSheet, Platform, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';

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

export function NativeMap({ region, markerCoords, markers, radiusKm, onPress, style }: NativeMapProps) {
  const [mapLoading, setMapLoading] = useState(true);

  const lat = markerCoords?.latitude ?? region.latitude;
  const lng = markerCoords?.longitude ?? region.longitude;

  const allMarkers = markers ? markers : (markerCoords ? [{
    id: 'main', latitude: lat, longitude: lng, title: 'Selected Location', pinColor: '#EF4444'
  }] : []);

  const markersJson = JSON.stringify(allMarkers);
  const radiusMeters = radiusKm ? radiusKm * 1000 : 0;

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.webFallback}>
          <Ionicons name="map" size={60} color="#3B82F6" />
          <Text style={styles.coordsText}>{lat.toFixed(6)}, {lng.toFixed(6)}</Text>
          {radiusKm ? <Text style={styles.radiusText}>Radius: {radiusKm} km</Text> : null}
        </View>
      </View>
    );
  }

  const osmHtml = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>* { margin:0;padding:0; } html,body,#map { width:100vw;height:100vh;background:#0F172A; }</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map',{zoomControl:true}).setView([${region.latitude},${region.longitude}],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
    var markersData=${markersJson};
    var leafletMarkers=[];
    markersData.forEach(function(m){
      var color=m.pinColor||'#EF4444';
      var icon=L.divIcon({html:'<div style="background:'+color+';width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',className:'',iconSize:[18,18],iconAnchor:[9,9]});
      var marker=L.marker([m.latitude,m.longitude],{icon:icon,draggable:true}).addTo(map);
      if(m.title) marker.bindPopup('<b>'+m.title+'</b>'+(m.description?'<br>'+m.description:''));
      marker.on('dragend',function(e){
        var ll=e.target.getLatLng();
        if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({lat:ll.lat,lng:ll.lng}));
      });
      leafletMarkers.push(marker);
    });
    ${radiusMeters > 0 && allMarkers.length > 0 ? `var radiusCircle=L.circle([${lat},${lng}],{radius:${radiusMeters},color:'#3B82F6',fillColor:'#3B82F6',fillOpacity:0.1,weight:2}).addTo(map);` : ''}
    map.on('click',function(e){
      if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng}));
      if(leafletMarkers.length>0){
        leafletMarkers[0].setLatLng(e.latlng);
        ${radiusMeters > 0 ? "if(radiusCircle) radiusCircle.setLatLng(e.latlng);" : ''}
      }
    });
  </script>
</body>
</html>`;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.lat && data.lng && onPress) {
        onPress({ latitude: data.lat, longitude: data.lng });
      }
    } catch (e) {}
  };

  return (
    <View style={[styles.container, style]}>
      {mapLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
      <WebView
        source={{ html: osmHtml }}
        style={styles.webview}
        onLoad={() => setMapLoading(false)}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        allowFileAccess
        geolocationEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  webview: { flex: 1, backgroundColor: '#0F172A' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#0F172A',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  loadingText: { color: '#94A3B8', marginTop: 12, fontSize: 14 },
  webFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  coordsText: { color: '#94A3B8', fontSize: 14, marginTop: 12 },
  radiusText: { color: '#3B82F6', fontSize: 14, marginTop: 8, fontWeight: '500' },
});
