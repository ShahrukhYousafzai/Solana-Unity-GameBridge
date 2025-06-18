
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  // Fullscreen loading state, similar to how the game itself will be displayed
  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-white items-center justify-center">
      <header className="absolute top-0 left-0 right-0 z-[100] w-full border-b border-gray-700 bg-gray-800/95 backdrop-blur supports-[backdrop-filter]:bg-gray-800/60">
        <div className="container flex h-16 items-center justify-between px-4 md:px-6 mx-auto">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-md bg-gray-700" />
              <Skeleton className="h-7 w-32 bg-gray-700" />
            </div>
            <Skeleton className="h-10 w-36 rounded-md bg-gray-700" />
          </div>
          <Skeleton className="h-10 w-32 rounded-md bg-gray-700" />
        </div>
      </header>
      <div className="text-center">
        <svg className="animate-spin h-12 w-12 text-primary mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-xl">Loading Application...</p>
      </div>
    </div>
  );
}
