import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthCard(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{props.title}</CardTitle>
          {props.description && <CardDescription>{props.description}</CardDescription>}
        </CardHeader>
        <CardContent>{props.children}</CardContent>
      </Card>
    </main>
  );
}
