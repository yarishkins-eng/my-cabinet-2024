import apiClient from './client';
import { ThemeSettings, DEFAULT_THEME_COLORS } from '../types/theme';

export const themeColorsApi = {
  // Get current theme colors (public, no auth required)
  getColors: async (): Promise<ThemeSettings> => {
    try {
      const response = await apiClient.get<ThemeSettings>('/cabinet/branding/colors');
      return response.data;
    } catch {
      // Return default colors if endpoint not available
      return DEFAULT_THEME_COLORS;
    }
  },

  // Update theme colors (admin only)
  updateColors: async (colors: Partial<ThemeSettings>): Promise<ThemeSettings> => {
    const response = await apiClient.patch<ThemeSettings>('/cabinet/branding/colors', colors);
    return response.data;
  },

  // Reset to default colors (admin only)
  resetColors: async (): Promise<ThemeSettings> => {
    const response = await apiClient.post<ThemeSettings>('/cabinet/branding/colors/reset');
    return response.data;
  },
};
