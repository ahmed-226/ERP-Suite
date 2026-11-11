import type { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#2f54eb',
    borderRadius: 6,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      bodyBg: '#f5f6f8',
    },
    Menu: {
      itemBorderRadius: 6,
    },
  },
};
