import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-20 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-7 w-24" />
          </div>
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </header>
      <main className="flex-1 container mx-auto p-4 md:p-6 space-y-8">
        <section className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </section>
        <section>
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </section>
        <section>
          <div className="border rounded-lg p-4">
            <Skeleton className="h-8 w-1/3 mb-4" />
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border rounded-lg p-2">
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="aspect-square w-full mb-2" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="py-6 border-t">
        <div className="container text-center">
          <Skeleton className="h-4 w-1/4 mx-auto mb-1" />
          <Skeleton className="h-4 w-1/3 mx-auto" />
        </div>
      </footer>
    </div>
  );
}
