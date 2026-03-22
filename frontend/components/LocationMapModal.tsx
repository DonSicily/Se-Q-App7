import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Modal, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';

interface LocationMapModalProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
}

export function LocationMapModal({ visible, onClose, latitude, longitude, title, subtitle }: LocationMapModalProps) {
  const [mapLoading, setMapLoading] = useState(true);

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
    var map = L.map('map',{zoomControl:true}).setView([${latitude},${longitude}],15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
    var icon=L.divIcon({
      html:'<div style="background:#EF4444;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.5);"></div>',
      className:'',iconSize:[22,22],iconAnchor:[11,11]
    });
    L.marker([${latitude},${longitude}],{icon:icon}).addTo(map)
      .bindPopup('${(title || 'Location').replace(/'/g, "\\'")}').openPopup();
  </script>
</body>
</html>`;

  const openExternalMaps = () => {
    const url = Platform.OS === 'ios'
      ? `maps:?q=${encodeURIComponent(title || 'Location')}&ll=${latitude},${longitude}`
      : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(title || 'Location')})`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps?q=${latitude},${longitude}`);
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{title || 'Location'}</Text>
            {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
          </View>
          <TouchableOpacity onPress={openExternalMaps} style={styles.closeButton}>
            <Ionicons name="open-outline" size={24} color="#3B82F6" />
          </TouchableOpacity>
        </View>

        {Platform.OS === 'web' ? (
          <View style={styles.webContainer}>
            <Ionicons name="location" size={60} color="#3B82F6" />
            <Text style={styles.coordsText}>{latitude.toFixed(6)}, {longitude.toFixed(6)}</Text>
            <TouchableOpacity style={styles.openMapsButton} onPress={openExternalMaps}>
              <Ionicons name="open-outline" size={20} color="#fff" />
              <Text style={styles.openMapsText}>Open in Google Maps</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mapContainer}>
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
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
            />
          </View>
        )}

        <View style={styles.bottomInfo}>
          <View style={styles.coordsCard}>
            <Ionicons name="navigate" size={24} color="#3B82F6" />
            <View style={styles.coordsInfo}>
              <Text style={styles.coordsLabel}>Coordinates</Text>
              <Text style={styles.coordsValue}>{latitude.toFixed(6)}, {longitude.toFixed(6)}</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 50 : 16, paddingBottom: 16,
    backgroundColor: '#1E293B',
  },
  closeButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerInfo: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: '#94A3B8', marginTop: 2 },
  mapContainer: { flex: 1, position: 'relative' },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#0F172A',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  loadingText: { color: '#94A3B8', marginTop: 12 },
  webContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E293B' },
  coordsText: { color: '#94A3B8', fontSize: 16, marginTop: 16 },
  openMapsButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#3B82F6',
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 24,
  },
  openMapsText: { color: '#fff', fontWeight: '600' },
  bottomInfo: { backgroundColor: '#1E293B', padding: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  coordsCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0F172A', padding: 16, borderRadius: 12 },
  coordsInfo: { flex: 1 },
  coordsLabel: { color: '#64748B', fontSize: 12 },
  coordsValue: { color: '#fff', fontSize: 14, fontWeight: '500', marginTop: 2 },
});

// Inline map for cards
export function InlineLocationMap({ latitude, longitude, height = 150 }: { latitude: number; longitude: number; height?: number }) {
  const [loading, setLoading] = useState(true);

  if (Platform.OS === 'web') {
    return (
      <View style={[{ height, backgroundColor: '#1E293B', borderRadius: 8, justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="location" size={32} color="#3B82F6" />
        <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 8 }}>{latitude.toFixed(4)}, {longitude.toFixed(4)}</Text>
      </View>
    );
  }

  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><style>*{margin:0;padding:0}html,body,#map{width:100vw;height:100vh;background:#0F172A}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>var map=L.map('map',{zoomControl:false,scrollWheelZoom:false,dragging:false}).setView([${latitude},${longitude}],14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);var icon=L.divIcon({html:'<div style="background:#EF4444;width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>',className:'',iconSize:[14,14],iconAnchor:[7,7]});L.marker([${latitude},${longitude}],{icon:icon}).addTo(map);</script></body></html>`;

  return (
    <View style={{ height, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      {loading && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#1E293B', justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#3B82F6" />
        </View>
      )}
      <WebView source={{ html }} style={{ flex: 1 }} onLoad={() => setLoading(false)} javaScriptEnabled domStorageEnabled originWhitelist={['*']} mixedContentMode="always" scrollEnabled={false} />
    </View>
  );
}
