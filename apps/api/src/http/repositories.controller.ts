import { Controller, Get, Param } from '@nestjs/common';
import { VerificationRepository } from '../storage/verification.repository';

@Controller()
export class RepositoriesController {
  constructor(private readonly repository: VerificationRepository) {}

  @Get('repos')
  async listRepositories() {
    return await this.repository.listRepositories();
  }

  @Get('repos/:id/prs')
  async listPullRequests(@Param('id') id: string) {
    return await this.repository.listPullRequests(id);
  }
}
