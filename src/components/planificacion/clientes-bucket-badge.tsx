import { Badge } from "@/components/ui/badge";
import {
  bucketLevelBadgeClass,
  bucketLevelLabel,
} from "@/lib/client-buckets";
import type { ClientBucketLevel } from "@/lib/client-buckets-types";

export function ClientesBucketBadge({ level }: { level: ClientBucketLevel }) {
  return (
    <Badge
      variant="outline"
      className={`h-5 shrink-0 px-1.5 text-[10px] font-bold tabular-nums ${bucketLevelBadgeClass(level)}`}
      title={`Bolsa ${bucketLevelLabel(level)}`}
    >
      {bucketLevelLabel(level)}
    </Badge>
  );
}
