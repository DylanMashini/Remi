import { NativeTabs } from 'expo-router/native-tabs';

import { Colors, Fonts } from '@/constants/theme';
import { useGlassesFeed, useReminderPoller } from '@/lib/feed';
import { useSession } from '@/lib/session';

export default function TabsLayout() {
  const { backendUrl, token } = useSession();
  useGlassesFeed();
  useReminderPoller(backendUrl, token);

  return (
    <NativeTabs
      backgroundColor={Colors.surface}
      tintColor={Colors.harborDeep}
      iconColor={{ default: Colors.inkSoft, selected: Colors.harborDeep }}
      labelStyle={{
        default: { color: Colors.inkSoft, fontFamily: Fonts.bodyBold },
        selected: { color: Colors.harborDeep, fontFamily: Fonts.bodyBold },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Live</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'eyeglasses', selected: 'eyeglasses' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="enroll">
        <NativeTabs.Trigger.Label>Enroll</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle.badge.plus', selected: 'person.crop.circle.fill.badge.plus' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="people">
        <NativeTabs.Trigger.Label>People</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
