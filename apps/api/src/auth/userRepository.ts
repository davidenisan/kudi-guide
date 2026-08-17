export type AuthUser = {
  id: string;
  phone: string | null;
};

export interface UserRepository {
  findById(id: string): Promise<AuthUser | null>;
  findByPhone(phone: string): Promise<AuthUser | null>;
  findOrCreateByPhone(phone: string): Promise<AuthUser>;
}

export class PrismaUserRepository implements UserRepository {
  async findById(id: string) {
    const { prisma } = await import("../db/prisma.js");
    return prisma.user.findUnique({ where: { id } });
  }

  async findByPhone(phone: string) {
    const { prisma } = await import("../db/prisma.js");
    return prisma.user.findUnique({ where: { phone } });
  }

  async findOrCreateByPhone(phone: string) {
    const existingUser = await this.findByPhone(phone);

    if (existingUser) {
      return existingUser;
    }

    const { prisma } = await import("../db/prisma.js");
    return prisma.user.create({
      data: {
        phone,
        authProvider: "phone",
      },
    });
  }
}
