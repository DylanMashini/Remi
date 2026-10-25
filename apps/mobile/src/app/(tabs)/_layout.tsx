import { NativeTabs } from 'expo-router/native-tabs';

import { Colors, Fonts } from '@/constants/theme';
import { useGlassesFeed, useReminderPoller } from '@/lib/feed';
import { useSession } from '@/lib/session';

export default function TabsLayout() {
  const { token } = useSession();
  useGlassesFeed();
  useReminderPoller(token);

  return (
    <NativeTabs
      backgroundColor={Colors.surface}
      tintColor={Colors.duskDeep}
      iconColor={{ default: Colors.inkSoft, selected: Colors.duskDeep }}
      disableTransparentOnScrollEdge
      labelStyle={{
        default: { color: Colors.inkSoft, fontFamily: Fonts.bodyBold, fontSize: 11 },
        selected: { color: Colors.duskDeep, fontFamily: Fonts.bodyBold, fontSize: 11 },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sunrise', selected: 'sunrise.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="live">
        <NativeTabs.Trigger.Label>Live</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'eyeglasses', selected: 'eyeglasses' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="remember">
        <NativeTabs.Trigger.Label>Remember</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'photo.on.rectangle', selected: 'photo.fill.on.rectangle.fill' }} />
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
