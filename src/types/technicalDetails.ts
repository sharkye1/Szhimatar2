export interface TechnicalDetails {
  timestamp: string;
  url: string;
  command: string;
  executable: string;
  arguments?: string[];
  exit_code?: number | null;
  status: string;
  error_classification?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  os: string;
  arch: string;
  is_network_error: boolean;
  hint?: string | null;
  environment?: string[];
}
