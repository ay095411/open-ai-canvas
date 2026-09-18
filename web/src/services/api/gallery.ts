import { compactApiParams, http } from "./request";

export type GalleryPromptItem = {
    id: number;
    slug: string;
    title: string;
    description: string;
    prompt: string;
    prompt_zh: string;
    model: string;
    media_type: "image" | "video";
    cover_url: string;
    media_url: string;
    media_width: number;
    media_height: number;
    tags: string[];
    featured: boolean;
    is_active: boolean;
    sort_order: number;
    view_count: number;
    copy_count: number;
    created_at: string;
    updated_at: string;
};

export type GalleryListResponse = {
    items: GalleryPromptItem[];
    total: number;
    page: number;
    pageSize: number;
};

export type GalleryFacetsResponse = {
    total: number;
    by_media: Record<string, number>;
    by_model: Record<string, number>;
    top_tags: { tag: string; count: number }[];
};

export type GalleryQueryParams = {
    page?: number;
    pageSize?: number;
    media_type?: string;
    model?: string;
    tag?: string;
    keyword?: string;
};

export async function fetchGalleryItems(params?: GalleryQueryParams): Promise<GalleryListResponse> {
    return http.get<GalleryListResponse>("/gallery/items", {
        params: compactApiParams({
            page: params?.page,
            pageSize: params?.pageSize,
            media_type: params?.media_type,
            model: params?.model,
            tag: params?.tag,
            keyword: params?.keyword,
        }),
    });
}

export async function fetchGalleryFacets(): Promise<GalleryFacetsResponse> {
    return http.get<GalleryFacetsResponse>("/gallery/facets");
}

export async function fetchGalleryDetail(slug: string): Promise<GalleryPromptItem> {
    return http.get<GalleryPromptItem>(`/gallery/items/${encodeURIComponent(slug)}`);
}

export async function recordGalleryPromptCopy(id: number): Promise<boolean> {
    return http.post<boolean>(`/gallery/items/${id}/copy`);
}

// 管理员维护接口
export async function fetchAdminGalleryItems(params?: GalleryQueryParams): Promise<GalleryListResponse> {
    return http.get<GalleryListResponse>("/admin/gallery/items", {
        params: compactApiParams({
            page: params?.page,
            pageSize: params?.pageSize,
            media_type: params?.media_type,
            model: params?.model,
            tag: params?.tag,
            keyword: params?.keyword,
        }),
    });
}

export async function importGalleryItems(file: File): Promise<{ imported_count: number }> {
    const formData = new FormData();
    formData.append("file", file);
    return http.post<{ imported_count: number }>("/admin/gallery/import", formData);
}

export async function setGalleryItemActive(id: number, isActive: boolean): Promise<boolean> {
    return http.patch<boolean>(`/admin/gallery/items/${id}/active`, { is_active: isActive });
}

export async function deleteGalleryItem(id: number): Promise<boolean> {
    return http.delete<boolean>(`/admin/gallery/items/${id}`);
}
