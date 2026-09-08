export interface Product {
  id: number;
  title: string;
  description: string;
  priceInCents: number;
  imageUrl: string;
  imageAlt: string;
  category: string;
}

export interface CartLine {
  product: Product;
  quantity: number;
}
