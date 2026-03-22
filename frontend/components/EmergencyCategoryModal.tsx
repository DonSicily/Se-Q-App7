import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface EmergencyCategoryModalProps {
  visible: boolean;
  onSelect: (category: string) => void;
  onCancel: () => void;
}

const EMERGENCY_CATEGORIES = [
  { id: 'violence', icon: 'warning', label: 'Violence/Assault', color: '#EF4444' },
  { id: 'robbery', icon: 'hand-right', label: 'Armed Robbery', color: '#DC2626' },
  { id: 'kidnapping', icon: 'car', label: 'Kidnapping/Abduction', color: '#B91C1C' },
  { id: 'burglary', icon: 'home', label: 'Break-in/Burglary', color: '#F59E0B' },
  { id: 'medical', icon: 'medical', label: 'Medical Emergency', color: '#EF4444' },
  { id: 'fire', icon: 'flame', label: 'Fire/Accident', color: '#DC2626' },
  { id: 'harassment', icon: 'person', label: 'Harassment/Stalking', color: '#F97316' },
  { id: 'other', icon: 'alert-circle', label: 'Other Emergency', color: '#6B7280' },
];

export default function EmergencyCategoryModal({ visible, onSelect, onCancel }: EmergencyCategoryModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const handleSelect = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setTimeout(() => {
      onSelect(categoryId);
      setSelectedCategory(null);
    }, 200);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Ionicons name="alert-circle" size={32} color="#EF4444" />
            <Text style={styles.title}>Select Emergency Type</Text>
            <Text style={styles.subtitle}>This helps security teams respond faster</Text>
          </View>

          <ScrollView style={styles.categoriesContainer} showsVerticalScrollIndicator={false}>
            {EMERGENCY_CATEGORIES.map((category) => (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.categoryButton,
                  selectedCategory === category.id && styles.categoryButtonSelected
                ]}
                onPress={() => handleSelect(category.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconContainer, { backgroundColor: category.color + '20' }]}>
                  <Ionicons name={category.icon as any} size={24} color={category.color} />
                </View>
                <Text style={styles.categoryLabel}>{category.label}</Text>
                <Ionicons name="chevron-forward" size={20} color="#64748B" />
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    padding: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  categoriesContainer: {
    padding: 16,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryButtonSelected: {
    borderColor: '#EF4444',
    backgroundColor: '#1E293B',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  categoryLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cancelButton: {
    padding: 20,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94A3B8',
  },
});
