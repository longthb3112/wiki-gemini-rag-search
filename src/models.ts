export interface Wiki {
  id: string;
  name: string;
  type: string;
  projectId: string;
}

export interface WikiListResponse {
  value: Wiki[];
}

export interface WikiPage {
  id: number;
  path: string;
  order?: number;
  content?: string;
}

export interface WikiPageListResponse {
  value: WikiPage[];
}