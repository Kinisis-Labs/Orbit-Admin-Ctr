import { Download, Clipboard, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CsvToolbarProps {
  handleExport: () => void;
  handleCopy: () => void;
  disabled: boolean;
  copied: boolean;
}

export function CsvToolbar({ handleExport, handleCopy, disabled, copied }: CsvToolbarProps) {
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleExport}
                disabled={disabled}
                style={disabled ? { pointerEvents: "none" } : undefined}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
            </span>
          </TooltipTrigger>
          {disabled && <TooltipContent>No rows to export</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 rounded-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={handleCopy}
                disabled={disabled}
                style={disabled ? { pointerEvents: "none" } : undefined}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                    <span className="text-green-500">Copied!</span>
                  </>
                ) : (
                  <>
                    <Clipboard className="h-3.5 w-3.5 mr-1.5" />
                    Copy
                  </>
                )}
              </Button>
            </span>
          </TooltipTrigger>
          {disabled && <TooltipContent>No rows to export</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
    </>
  );
}
