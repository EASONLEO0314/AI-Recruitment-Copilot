export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface HealthResponse {
  request_id: string;
  status: 'ok';
  service: 'ai-recruitment-copilot';
  version: '0.1.0';
}

export interface DimensionResult {
  key: string;
  name: string;
  score: number;
  weight: number;
  confidence: number;
  reason: string;
  evidence: string[];
}

export type MessageType = 'greeting' | 'interview_invitation' | 'phone_script';

export interface MessageSuggestion {
  type: MessageType;
  label: string;
  content: string;
}

export interface AssessmentResponse {
  request_id: string;
  mode: 'demo';
  candidate_label: string;
  job_title: string;
  total_score: number;
  recommendation: string;
  dimensions: DimensionResult[];
  highlights: string[];
  risk_flags: string[];
  follow_up_questions: string[];
  messages: MessageSuggestion[];
}
